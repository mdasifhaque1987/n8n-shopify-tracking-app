/* eslint-disable @typescript-eslint/no-explicit-any */
import { applyEventSecurityPrecheck } from "../services/security/event-security.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeIncomingEvent } from "../services/normalize-event.server";
import { createEventDeliveryLog, sanitizeTrackingEvent } from "../services/event-delivery-log.server";
import { dispatchPurchaseToGoogleAds } from "../services/dispatchers/google-ads.dispatcher";
import { enrichShopifyOrderCustomer } from "../services/shopify-order-enrichment.server";
import { isTestModeEnabled } from "../services/test-mode.server";
import { dispatchToGA4 } from "../services/dispatchers/ga4.dispatcher";
import { dispatchToMeta } from "../services/dispatchers/meta.dispatcher";

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

async function parseTrackingPayload(request: Request) {
  const rawBody = await request.text();

  if (!rawBody || !rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error("Invalid tracking payload JSON.");
  }
}


function mapGa4EventToMeta(eventName: string) {
  const map: Record<string, string> = {
    page_view: "PageView",
    view_item: "ViewContent",
    view_item_list: "ViewContentList",
    view_cart: "ViewContent",
    add_to_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    add_payment_info: "AddPaymentInfo",
    add_shipping_info: "AddShippingInfo",
    add_contact_info: "Lead",
    purchase: "Purchase",
    search: "Search",
    generate_lead: "Lead",
    sign_up: "CompleteRegistration",
  };

  return map[eventName] || eventName;
}



type DeliveryStatus =
  | "received"
  | "success"
  | "sent"
  | "failed"
  | "skipped";

const validDeliveryStatuses = new Set<DeliveryStatus>([
  "received",
  "success",
  "sent",
  "failed",
  "skipped",
]);

function normalizeDeliveryStatus(value: unknown): DeliveryStatus {
  const status = String(
    value || "failed"
  ) as DeliveryStatus;

  return validDeliveryStatuses.has(status)
    ? status
    : "failed";
}

type ClientDeliveryReport = {
  platform: "ga4" | "google_ads";
  status: DeliveryStatus;
  message: string;
  responsePayload: Record<string, unknown>;
};

function getClientDeliveryReports(
  payload: any
): ClientDeliveryReport[] {
  const rawReports =
    payload?.client_deliveries;

  if (!Array.isArray(rawReports)) {
    return [];
  }

  const reports: ClientDeliveryReport[] = [];

  for (
    const rawReport of rawReports.slice(0, 50)
  ) {
    if (
      !rawReport ||
      typeof rawReport !== "object" ||
      Array.isArray(rawReport)
    ) {
      continue;
    }

    const report =
      rawReport as Record<string, unknown>;

    const platform = String(
      report.platform || ""
    ).trim();

    if (
      platform !== "ga4" &&
      platform !== "google_ads"
    ) {
      continue;
    }

    const rawStatus = String(
      report.status || "sent"
    );

    const status: DeliveryStatus =
      rawStatus === "failed"
        ? "failed"
        : rawStatus === "skipped"
          ? "skipped"
          : "sent";

    const message =
      String(
        report.message ||
          "Client request dispatched."
      )
        .trim()
        .slice(0, 500) ||
      "Client request dispatched.";

    const responsePayload:
      Record<string, unknown> = {
        clientReported: true,
        browserResponseVerifiable: false,
      };

    const allowedFields = [
      "eventName",
      "conversionName",
      "conversionActionId",
      "conversionId",
      "conversionLabel",
      "measurementId",
      "error",
    ];

    for (const key of allowedFields) {
      const value = report[key];

      if (
        typeof value === "string" &&
        value.trim()
      ) {
        responsePayload[key] =
          value.trim().slice(0, 500);
      }
    }

    reports.push({
      platform,
      status,
      message,
      responsePayload,
    });
  }

  return reports;
}

const recentMetaRouteSends =
  new Map<string, number>();

function claimMetaRouteSend(
  shop: string,
  eventName: string,
  eventId: string,
  metaEventName: string
) {
  const now = Date.now();
  const ttlMs = 2 * 60 * 1000;

  for (const [key, timestamp] of recentMetaRouteSends.entries()) {
    if (now - timestamp > ttlMs) {
      recentMetaRouteSends.delete(key);
    }
  }

  const key = `${shop}:${eventName}:${eventId}:${metaEventName}`;
  const previous = recentMetaRouteSends.get(key);

  if (previous && now - previous < ttlMs) {
    return false;
  }

  recentMetaRouteSends.set(key, now);
  return true;
}

function resolveMetaEventName(eventName: string, payloadMetaEvent?: string | null) {
  const mappedEvent = mapGa4EventToMeta(eventName);

  // For Shopify checkout step events, always trust our server-side eventName mapping.
  // This prevents stale browser payloads from sending add_shipping_info as InitiateCheckout.
  if (
    eventName === "begin_checkout" ||
    eventName === "add_shipping_info" ||
    eventName === "add_payment_info" ||
    eventName === "purchase"
  ) {
    return mappedEvent;
  }

  return payloadMetaEvent || mappedEvent;
}


function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    null
  );
}

async function findRecentMetaServerDelivery(input: {
  workspaceId: string;
  shop?: string | null;
  eventId: string;
  eventName: string;
}) {
  const recentWindow = new Date(Date.now() - 60 * 60 * 1000);

  return db.eventDeliveryLog.findFirst({
    where: {
      workspaceId: input.workspaceId,
      shop: input.shop || null,
      eventId: input.eventId,
      eventName: input.eventName,
      platform: "meta",
      deliveryType: "server",
      status: {
        in: ["sent", "success"],
      },
      createdAt: {
        gte: recentWindow,
      },
    },
    select: {
      id: true,
      createdAt: true,
      status: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

function getPayloadMetaSelectedEvents(payload: any): string[] {
  const selectedEvents = payload?.config?.meta?.selectedEvents;

  if (!Array.isArray(selectedEvents)) {
    return [];
  }

  return selectedEvents
    .map((eventName) => String(eventName || "").trim())
    .filter(Boolean);
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
    const payload = await parseTrackingPayload(request);
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
    let metaServerSideEnabled = false;
    let metaSelectedEvents: string[] = [];

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

    if (workspaceId) {
      const metaSelections = await db.shopAssetSelection.findMany({
        where: {
          workspaceId,
          platform: "meta",
          assetType: {
            in: [
              "Meta Server Side Enabled",
              "Meta Selected Events",
              "Meta Dataset / Pixel",
            ],
          },
        },
        select: {
          assetType: true,
          assetValue: true,
        },
      });

      const metaMap = new Map(
        metaSelections.map(
          (item: (typeof metaSelections)[number]) => [
            item.assetType,
            item.assetValue,
          ]
        )
      );

      metaServerSideEnabled =
        String(metaMap.get("Meta Server Side Enabled") || "false") === "true" &&
        Boolean(String(metaMap.get("Meta Dataset / Pixel") || "").trim());

      const rawMetaEvents = String(metaMap.get("Meta Selected Events") || "none");

      metaSelectedEvents =
        rawMetaEvents === "none" ? [] : parseCsvSetting(rawMetaEvents);
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
        mode: testModeEnabled
          ? "test"
          : "live",
        testMode: testModeEnabled,
      },
    });

    const clientDeliveryReports =
      getClientDeliveryReports(payload);

    for (
      const clientDelivery of
      clientDeliveryReports
    ) {
      await createEventDeliveryLog({
        workspaceId,
        shop,
        event: {
          ...event,
          shop,
        },
        platform:
          clientDelivery.platform,
        deliveryType: "client",
        status:
          clientDelivery.status,
        message: testModeEnabled
          ? `[TEST MODE] ${clientDelivery.message}`
          : clientDelivery.message,
        responsePayload: {
          ...clientDelivery.responsePayload,
          mode: testModeEnabled
            ? "test"
            : "live",
          testMode: testModeEnabled,
        },
      });
    }

    let googleAdsServerResult = null;

    if (
      workspaceId &&
      event.event_name === "purchase"
    ) {
      googleAdsServerResult =
        await dispatchPurchaseToGoogleAds(
          {
            ...event,
            shop,
          },
          workspaceId,
          {
            validateOnly:
              testModeEnabled,
            testMode:
              testModeEnabled,
          }
        );

      const googleAdsResponsePayload =
        googleAdsServerResult.responsePayload &&
        typeof googleAdsServerResult.responsePayload ===
          "object" &&
        !Array.isArray(
          googleAdsServerResult.responsePayload
        )
          ? {
              ...googleAdsServerResult.responsePayload,
              mode: testModeEnabled
                ? "test"
                : "live",
              testMode:
                testModeEnabled,
              validateOnly:
                testModeEnabled,
            }
          : {
              response:
                googleAdsServerResult.responsePayload ||
                null,
              mode: testModeEnabled
                ? "test"
                : "live",
              testMode:
                testModeEnabled,
              validateOnly:
                testModeEnabled,
            };

      const perActionResults =
        Array.isArray(
          (googleAdsResponsePayload as any)
            .results
        )
          ? (
              googleAdsResponsePayload as any
            ).results
          : [];

      if (perActionResults.length > 0) {
        for (
          const rawActionResult of
          perActionResults
        ) {
          const actionResult =
            rawActionResult &&
            typeof rawActionResult ===
              "object" &&
            !Array.isArray(rawActionResult)
              ? rawActionResult
              : {};

          const conversionName =
            String(
              actionResult.conversionName ||
                ""
            ).trim();

          const resultMessage =
            String(
              actionResult.message ||
                googleAdsServerResult.message
            );

          await createEventDeliveryLog({
            workspaceId,
            shop,
            event: {
              ...event,
              shop,
            },
            platform: "google_ads",
            deliveryType: "server",
            status:
              normalizeDeliveryStatus(
                actionResult.status
              ),
            message: testModeEnabled
              ? `[TEST MODE] ${
                  conversionName
                    ? `${conversionName}: `
                    : ""
                }${resultMessage}`
              : `${
                  conversionName
                    ? `${conversionName}: `
                    : ""
                }${resultMessage}`,
            responsePayload: {
              ...actionResult,
              apiMode:
                (
                  googleAdsResponsePayload as any
                ).apiMode || null,
              mode: testModeEnabled
                ? "test"
                : "live",
              testMode:
                testModeEnabled,
              validateOnly:
                testModeEnabled,
            },
          });
        }
      } else {
        await createEventDeliveryLog({
          workspaceId,
          shop,
          event: {
            ...event,
            shop,
          },
          platform: "google_ads",
          deliveryType: "server",
          status:
            normalizeDeliveryStatus(
              googleAdsServerResult.status
            ),
          message: testModeEnabled
            ? `[TEST MODE] ${googleAdsServerResult.message}`
            : googleAdsServerResult.message,
          responsePayload:
            googleAdsResponsePayload,
        });
      }
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
        status: normalizeDeliveryStatus(ga4ServerResult.status),
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

    let metaServerResult = null;

    if (workspaceId && metaServerSideEnabled) {
      const metaEventName = resolveMetaEventName(
        event.event_name,
        event.meta_event
      );

      const metaSkipRequested =
        Boolean(event.meta && (event.meta as any).skip === true);

      const payloadMetaSelectedEvents = getPayloadMetaSelectedEvents(payload);

      const effectiveMetaSelectedEvents = Array.from(
        new Set([...metaSelectedEvents, ...payloadMetaSelectedEvents])
      );

      const metaEventSelected = effectiveMetaSelectedEvents.includes(metaEventName);

      if (metaSkipRequested) {
        metaServerResult = {
          success: false,
          status: "skipped",
          message: `Meta CAPI skipped. Browser pixel marked this event as duplicate: ${(event.meta as any)?.skip_reason || "duplicate"}.`,
          responsePayload: {
            eventSelected: metaEventSelected,
            selectedEvents: metaSelectedEvents,
            metaEventName,
            skipReason: (event.meta as any)?.skip_reason || "duplicate",
          },
        };
      } else if (metaEventSelected) {
        const metaRouteSendClaimed = claimMetaRouteSend(
          shop ?? "",
          event.event_name,
          event.event_id,
          metaEventName
        );

        if (!metaRouteSendClaimed) {
          metaServerResult = {
            success: false,
            status: "skipped",
            message: `Meta CAPI skipped. Duplicate in-flight event already claimed for event_id ${event.event_id}.`,
            responsePayload: {
              duplicate: true,
              inFlightDuplicate: true,
              eventId: event.event_id,
              eventName: event.event_name,
              metaEventName,
            },
          };
        } else {
          const previousMetaDelivery = await findRecentMetaServerDelivery({
            workspaceId,
            shop,
            eventId: event.event_id,
            eventName: event.event_name,
          });

        if (previousMetaDelivery) {
          metaServerResult = {
            success: false,
            status: "skipped",
            message: `Meta CAPI skipped. Duplicate server event already sent for event_id ${event.event_id}.`,
            responsePayload: {
              duplicate: true,
              previousLogId: previousMetaDelivery.id,
              previousStatus: previousMetaDelivery.status,
              previousCreatedAt: previousMetaDelivery.createdAt,
              eventId: event.event_id,
              eventName: event.event_name,
              metaEventName,
            },
          };
          } else {
            metaServerResult = await dispatchToMeta(
              {
                ...event,
                shop,
                meta_event: metaEventName,
              },
              workspaceId,
              {
                testMode: testModeEnabled,
                clientIpAddress: getClientIp(request),
                clientUserAgent: request.headers.get("user-agent"),
              }
            );
          }
        }
      } else {
        metaServerResult = {
          success: false,
          status: "skipped",
          message: `Meta CAPI skipped. Event ${metaEventName} is not selected.`,
          responsePayload: {
            eventSelected: false,
            selectedEvents: metaSelectedEvents,
            metaEventName,
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
        platform: "meta",
        deliveryType: "server",
        status: normalizeDeliveryStatus(metaServerResult.status),
        message: testModeEnabled
          ? `[TEST MODE] ${metaServerResult.message}`
          : metaServerResult.message,
        responsePayload: metaServerResult.responsePayload || {},
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
        metaEvent: resolveMetaEventName(event.event_name, event.meta_event),
        googleAdsServer: googleAdsServerResult,
        ga4Server: ga4ServerResult,
        metaServer: metaServerResult,
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
