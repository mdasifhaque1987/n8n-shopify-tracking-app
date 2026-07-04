import { applyEventSecurityPrecheck } from "../services/security/event-security.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeIncomingEvent } from "../services/normalize-event.server";
import { createEventDeliveryLog, sanitizeTrackingEvent } from "../services/event-delivery-log.server";
import { dispatchPurchaseToGoogleAds } from "../services/dispatchers/google-ads.dispatcher";
import { enrichShopifyOrderCustomer } from "../services/shopify-order-enrichment.server";
import { isTestModeEnabled } from "../services/test-mode.server";
import { dispatchToGA4 } from "../services/dispatchers/ga4.dispatcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Cache-Control": "no-store",
};

function getShopFromRequest(request: Request, payload: any): string | null {
  const url = new URL(request.url);

  return (
    payload?.shop ||
    payload?.shop_domain ||
    payload?.shopDomain ||
    request.headers.get("X-Shopify-Shop-Domain") ||
    url.searchParams.get("shop") ||
    null
  );
}


function parseCsvSetting(value?: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  return Response.json(
    { ok: true, route: "/api/events/track", externalSending: false },
    { headers: corsHeaders }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const payload = await request.json();
    const securityPrecheck = await applyEventSecurityPrecheck(request, payload);

    if (!securityPrecheck.ok) {
      return securityPrecheck.response;
    }
    let event = normalizeIncomingEvent(payload);
    const shop = getShopFromRequest(request, payload) || event.shop || null;


    if (shop && event.event_name === "purchase") {
      event = await enrichShopifyOrderCustomer(event, shop);
    }

    let workspaceId: string | null = null;
    let testModeEnabled = false;
    let ga4ServerSideEnabled = false;
    let ga4SelectedEvents: string[] = [];

    if (shop) {
      const shopSettings = await db.shopSettings.findUnique({
        where: { shop },
        select: { workspaceId: true },
      });

      workspaceId = shopSettings?.workspaceId || null;
    }

    if (workspaceId) {
      testModeEnabled = await isTestModeEnabled(workspaceId);
    }

    if (workspaceId) {
      const [ga4DeliverySetting, ga4EventsSelection] = await Promise.all([
        db.platformDeliverySetting.findUnique({
          where: {
            workspaceId_platform: {
              workspaceId,
              platform: "GA4",
            },
          },
          select: {
            isActive: true,
            serverSideEnabled: true,
            deliveryMode: true,
          },
        }),
        db.shopAssetSelection.findUnique({
          where: {
            workspaceId_platform_assetType: {
              workspaceId,
              platform: "google",
              assetType: "GA4 Property:events",
            },
          },
          select: {
            assetValue: true,
          },
        }),
      ]);

      ga4ServerSideEnabled = Boolean(
        ga4DeliverySetting?.isActive &&
          (ga4DeliverySetting.serverSideEnabled || ga4DeliverySetting.deliveryMode === "server")
      );

      ga4SelectedEvents = parseCsvSetting(ga4EventsSelection?.assetValue);
    }

    const log = await createEventDeliveryLog({
      workspaceId,
      shop,
      event: {
        ...event,
        shop,
      },
      platform: "internal",
      deliveryType: "server",
      status: "received",
      message: testModeEnabled
        ? "[TEST MODE] Event validated and logged."
        : "Event validated and logged.",
      responsePayload: {
        mode: testModeEnabled ? "test" : "live",
        testMode: testModeEnabled,
      },
    });

    let googleAdsServerResult = null;

    if (workspaceId && event.event_name === "purchase") {
      googleAdsServerResult = await dispatchPurchaseToGoogleAds(
        {
          ...event,
          shop,
        },
        workspaceId,
        {
          validateOnly: testModeEnabled,
          testMode: testModeEnabled,
        }
      );

      const googleAdsResponsePayload =
        googleAdsServerResult.responsePayload &&
        typeof googleAdsServerResult.responsePayload === "object" &&
        !Array.isArray(googleAdsServerResult.responsePayload)
          ? {
              ...googleAdsServerResult.responsePayload,
              mode: testModeEnabled ? "test" : "live",
              testMode: testModeEnabled,
              validateOnly: testModeEnabled,
            }
          : {
              response: googleAdsServerResult.responsePayload || null,
              mode: testModeEnabled ? "test" : "live",
              testMode: testModeEnabled,
              validateOnly: testModeEnabled,
            };

      await createEventDeliveryLog({
        workspaceId,
        shop,
        event: {
          ...event,
          shop,
        },
        platform: "google_ads",
        deliveryType: "server",
        status: googleAdsServerResult.status,
        message: testModeEnabled
          ? `[TEST MODE] ${googleAdsServerResult.message}`
          : googleAdsServerResult.message,
        responsePayload: googleAdsResponsePayload,
      });
    }


    let ga4ServerResult = null;

    if (workspaceId && ga4ServerSideEnabled) {
      const ga4EventSelected =
        ga4SelectedEvents.length === 0 || ga4SelectedEvents.includes(event.event_name);

      if (ga4EventSelected) {
        ga4ServerResult = await dispatchToGA4(
          {
            ...event,
            shop,
          },
          workspaceId,
          {
            testMode: testModeEnabled,
            debugMode: testModeEnabled,
          }
        );
      } else {
        ga4ServerResult = {
          success: false,
          status: "skipped",
          message: `GA4 server-side skipped. Event ${event.event_name} is not selected.`,
          responsePayload: {
            mode: testModeEnabled ? "test" : "live",
            testMode: testModeEnabled,
            debugMode: testModeEnabled,
            eventSelected: false,
            selectedEvents: ga4SelectedEvents,
          },
        };
      }

      await createEventDeliveryLog({
        workspaceId,
        shop,
        event: {
          ...event,
          shop,
        },
        platform: "ga4",
        deliveryType: "server",
        status: ga4ServerResult.status,
        message: testModeEnabled
          ? `[TEST MODE] ${ga4ServerResult.message}`
          : ga4ServerResult.message,
        responsePayload: ga4ServerResult.responsePayload || {
          mode: testModeEnabled ? "test" : "live",
          testMode: testModeEnabled,
          debugMode: testModeEnabled,
        },
      });
    }

    return Response.json(
      {
        ok: true,
        received: true,
        logged: true,
        logId: log.id,
        workspaceFound: Boolean(workspaceId),
        eventName: event.event_name,
        eventId: event.event_id,
        googleAdsServer: googleAdsServerResult,
        ga4Server: ga4ServerResult,
        sanitized: sanitizeTrackingEvent(event),
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400, headers: corsHeaders }
    );
  }
}
