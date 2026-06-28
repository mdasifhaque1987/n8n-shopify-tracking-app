import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeIncomingEvent } from "../services/normalize-event.server";
import { createEventDeliveryLog, sanitizeTrackingEvent } from "../services/event-delivery-log.server";

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
    const event = normalizeIncomingEvent(payload);
    const shop = getShopFromRequest(request, payload) || event.shop || null;

    let workspaceId: string | null = null;

    if (shop) {
      const shopSettings = await db.shopSettings.findUnique({
        where: { shop },
        select: { workspaceId: true },
      });

      workspaceId = shopSettings?.workspaceId || null;
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
      message: "Event validated and logged. External sending is disabled in this foundation phase.",
    });

    return Response.json(
      {
        ok: true,
        received: true,
        logged: true,
        logId: log.id,
        workspaceFound: Boolean(workspaceId),
        eventName: event.event_name,
        eventId: event.event_id,
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
