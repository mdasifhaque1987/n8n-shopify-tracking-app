/* eslint-disable @typescript-eslint/no-explicit-any */
export type NormalizedTrackingEvent = {
  shop?: string | null;
  event_name: string;
  meta_event?: string | null;
  event_id: string;
  event_time: number;
  client_id?: string | null;
  transaction_id?: string | null;

  page_location?: string | null;
  page_title?: string | null;
  page_referrer?: string | null;

  attribution?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  ecommerce?: Record<string, unknown> | null;
  consent?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
};

const allowedEvents = new Set([
  "page_view",
  "view_item_list",
  "view_item",
  "view_cart",
  "add_to_cart",
  "remove_from_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
  "search",
  "add_contact_info",
  "sign_up",
  "generate_lead",
]);

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNow(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Math.floor(Date.now() / 1000);
}

function getNestedObject(payload: any, key: string): Record<string, unknown> | null {
  const value = payload?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}


function buildRawTrackingObject(payload: any): Record<string, unknown> | null {
  const payloadRaw = getNestedObject(payload, "raw") || {};
  const output: Record<string, unknown> = {};

  const allowedKeys = [
    "client_id",
    "clientId",
    "ga_client_id",
    "gaClientId",
    "session_id",
    "sessionId",
    "ga_session_id",
    "gaSessionId",
    "external_id",
    "customer_id",
    "page_location",
    "page_title",
    "page_referrer",
    "currency",
    "value",
    "tax",
    "shipping",
    "transaction_id",
    "order_id",
    "checkout_token",
    "checkout_id",
    "items"
  ];

  for (const key of allowedKeys) {
    if (payloadRaw[key] !== undefined && payloadRaw[key] !== null && payloadRaw[key] !== "") {
      output[key] = payloadRaw[key];
    }

    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
      output[key] = payload[key];
    }
  }

  return Object.keys(output).length ? output : null;
}

function safeEventId(eventName: string, payload: any): string {
  const fromPayload =
    stringOrNull(payload.event_id) ||
    stringOrNull(payload.eventId) ||
    stringOrNull(payload.id);

  if (fromPayload) return fromPayload;

  const transactionId =
    stringOrNull(payload?.ecommerce?.transaction_id) ||
    stringOrNull(payload?.transaction_id) ||
    stringOrNull(payload?.order_id);

  if (eventName === "purchase" && transactionId) {
    return `purchase_${transactionId}`;
  }

  return `${eventName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeIncomingEvent(payload: any): NormalizedTrackingEvent {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload must be a JSON object");
  }

  const eventName =
    stringOrNull(payload.event_name) ||
    stringOrNull(payload.eventName) ||
    stringOrNull(payload.ga4_event) ||
    stringOrNull(payload.original_event);

  if (!eventName) {
    throw new Error("Missing event_name");
  }

  if (!allowedEvents.has(eventName)) {
    throw new Error(`Unsupported event_name: ${eventName}`);
  }

  const page = getNestedObject(payload, "page");

  return {
    shop:
      stringOrNull(payload.shop) ||
      stringOrNull(payload.shop_domain) ||
      stringOrNull(payload.shopDomain) ||
      null,

    event_name: eventName,
    meta_event: stringOrNull(payload.meta_event) || stringOrNull(payload.metaEvent) || null,
    event_id: safeEventId(eventName, payload),
    event_time: numberOrNow(payload.event_time || payload.eventTime),

    page_location:
      stringOrNull(payload.page_location) ||
      stringOrNull(page?.page_location) ||
      stringOrNull(page?.location) ||
      null,

    page_title:
      stringOrNull(payload.page_title) ||
      stringOrNull(page?.page_title) ||
      stringOrNull(page?.title) ||
      null,

    page_referrer:
      stringOrNull(payload.page_referrer) ||
      stringOrNull(payload.page_referrer_url) ||
      stringOrNull(page?.page_referrer) ||
      stringOrNull(page?.referrer) ||
      null,

    attribution: getNestedObject(payload, "attribution"),
    customer: getNestedObject(payload, "customer"),
    ecommerce: getNestedObject(payload, "ecommerce"),
    consent: getNestedObject(payload, "consent"),
    meta: getNestedObject(payload, "meta"),
    raw: buildRawTrackingObject(payload),
  };
}

export function stripUrlQuery(value?: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0].split("#")[0] || null;
  }
}
