/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { claimEventProcessing } from "../lib/utils/deduplication.server";
import { createEventDeliveryLog } from "../services/event-delivery-log.server";
import { persistShopifyCheckoutCorrelation } from "../services/shopify-checkout-correlation.server";
import { normalizeIncomingEvent } from "../services/normalize-event.server";
import {
  assertSubmittedShopMatches,
  EventIngestKeyError,
  EventIngestShopMismatchError,
  resolveEventIngestInstallation,
} from "../services/security/event-ingest-identity.server";
import {
  applyInstallationEventRateLimit,
  applyEventSecurityPrecheck,
} from "../services/security/event-security.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Cache-Control": "no-store",
};

async function withCors(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getSubmittedShop(payload: any): string | null {
  const value = payload?.shop || payload?.shop_domain || payload?.shopDomain;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function parseTrackingPayload(request: Request) {
  const rawBody = await request.text();

  const configuredMax = Number(process.env.EVENT_MAX_PAYLOAD_BYTES || 64 * 1024);
  const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : 64 * 1024;

  if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
    throw new PayloadTooLargeError();
  }

  if (!rawBody.trim()) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid tracking payload JSON.");
  }
}

class PayloadTooLargeError extends Error {
  status = 413;

  constructor() {
    super("Payload too large.");
    this.name = "PayloadTooLargeError";
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return Response.json(
    { ok: true, route: "/api/events/track", telemetryOnly: true },
    { headers: corsHeaders },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const payload = await parseTrackingPayload(request);
    const precheck = await applyEventSecurityPrecheck(request, payload);

    if (!precheck.ok) return withCors(precheck.response);

    const installation = await resolveEventIngestInstallation(request);
    const installationLimit = applyInstallationEventRateLimit(
      request,
      installation.installationId,
    );

    if (installationLimit) return withCors(installationLimit);

    assertSubmittedShopMatches(getSubmittedShop(payload), installation.shop);

    const event = normalizeIncomingEvent(payload);

    await persistShopifyCheckoutCorrelation({
      shop: installation.shop,
      event,
    });

    const deduplicationId = `pixel:${installation.installationId}:${event.event_id}`;
    const claimed = await claimEventProcessing(deduplicationId);

    if (!claimed) {
      return Response.json(
        { ok: true, received: true, duplicate: true },
        { headers: corsHeaders },
      );
    }

    await createEventDeliveryLog({
      workspaceId: installation.workspaceId,
      shop: installation.shop,
      event: { ...event, shop: installation.shop },
      platform: "internal",
      deliveryType: "client_telemetry",
      status: "received",
      message: "Untrusted client telemetry validated and received.",
    });

    return Response.json(
      {
        ok: true,
        received: true,
        duplicate: false,
        eventName: event.event_name,
        eventId: event.event_id,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof EventIngestKeyError || error instanceof EventIngestShopMismatchError) {
      return Response.json(
        { ok: false, error: error.message },
        { status: error.status, headers: corsHeaders },
      );
    }

    if (error instanceof PayloadTooLargeError) {
      return Response.json(
        { ok: false, error: error.message },
        { status: error.status, headers: corsHeaders },
      );
    }

    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid tracking request." },
      { status: 400, headers: corsHeaders },
    );
  }
}
