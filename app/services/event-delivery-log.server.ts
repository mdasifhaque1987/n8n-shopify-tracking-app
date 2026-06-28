import db from "../db.server";
import { stripUrlQuery, type NormalizedTrackingEvent } from "./normalize-event.server";

function hasString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAny(obj: Record<string, unknown> | null | undefined, keys: string[]): boolean {
  if (!obj) return false;
  return keys.some((key) => hasString(obj[key]));
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function sanitizeAttribution(attribution?: Record<string, unknown> | null) {
  return {
    has_gclid: hasString(attribution?.gclid),
    has_gbraid: hasString(attribution?.gbraid),
    has_wbraid: hasString(attribution?.wbraid),
    has_fbclid: hasString(attribution?.fbclid),
    has_fbp: hasString(attribution?.fbp),
    has_fbc: hasString(attribution?.fbc),
    has_ttclid: hasString(attribution?.ttclid),
    has_ttp: hasString(attribution?.ttp),
    has_epik: hasString(attribution?.epik),
    has_msclkid: hasString(attribution?.msclkid),
    has_li_fat_id: hasString(attribution?.li_fat_id),
  };
}

export function sanitizeTrackingEvent(event: NormalizedTrackingEvent) {
  const customer = event.customer || {};
  const ecommerce = event.ecommerce || {};
  const items = Array.isArray(ecommerce.items) ? ecommerce.items : [];

  return {
    event_name: event.event_name,
    event_id: event.event_id,
    event_time: event.event_time,

    page_location: stripUrlQuery(event.page_location),
    page_title: event.page_title || null,
    page_referrer: stripUrlQuery(event.page_referrer),

    customer: {
      has_email: hasString(customer.email),
      has_phone: hasString(customer.phone),

      has_first_name: hasString(customer.first_name) || hasString(customer.firstName),
      has_last_name: hasString(customer.last_name) || hasString(customer.lastName),
      has_name: hasAny(customer, ["first_name", "firstName", "last_name", "lastName", "name"]),

      has_address: hasAny(customer, [
        "address",
        "address1",
        "address2",
        "address_line_1",
        "address_line_2",
        "street",
        "city",
        "state",
        "province",
        "region",
        "zip",
        "postal_code",
        "postcode",
        "country",
        "country_code"
      ]),

      has_address_line_1: hasAny(customer, ["address", "address1", "address_line_1", "street"]),
      has_address_line_2: hasAny(customer, ["address2", "address_line_2"]),
      has_city: hasString(customer.city),
      has_state: hasAny(customer, ["state", "province", "region"]),
      has_zip: hasAny(customer, ["zip", "postal_code", "postcode"]),
      has_country: hasAny(customer, ["country", "country_code"]),

      has_external_id: hasString(customer.external_id) || hasString(customer.externalId) || hasString(customer.customer_id),
    },

    ecommerce: {
      has_transaction_id: hasString(ecommerce.transaction_id) || hasString(ecommerce.order_id),
      transaction_id: hasString(ecommerce.transaction_id) ? ecommerce.transaction_id : hasString(ecommerce.order_id) ? ecommerce.order_id : null,
      currency: hasString(ecommerce.currency) ? ecommerce.currency : null,
      value: toNumberOrNull(ecommerce.value),
      tax: toNumberOrNull(ecommerce.tax),
      shipping: toNumberOrNull(ecommerce.shipping),
      has_coupon: hasString(ecommerce.coupon),
      payment_type_present: hasString(ecommerce.payment_type),
      shipping_tier_present: hasString(ecommerce.shipping_tier),
      items_count: items.length,
    },

    attribution: sanitizeAttribution(event.attribution),
    consent: event.consent || null,
  };
}

export async function createEventDeliveryLog(data: {
  workspaceId?: string | null;
  shop?: string | null;
  event: NormalizedTrackingEvent;
  platform?: string;
  deliveryType?: string;
  status: "received" | "success" | "failed" | "skipped";
  message?: string;
  responsePayload?: Record<string, unknown> | null;
}) {
  return db.eventDeliveryLog.create({
    data: {
      workspaceId: data.workspaceId || null,
      shop: data.shop || data.event.shop || null,
      eventId: data.event.event_id,
      eventName: data.event.event_name,
      platform: data.platform || "internal",
      deliveryType: data.deliveryType || "server",
      status: data.status,
      message: data.message,
      requestPayload: sanitizeTrackingEvent(data.event),
      responsePayload: data.responsePayload || null,
    },
  });
}
