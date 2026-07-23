/* eslint-disable @typescript-eslint/no-explicit-any */
// Meta Conversions API Dispatcher
import axios from "axios";
import crypto from "crypto";
import db from "../../db.server";
import { decryptToken } from "../../lib/encryption.server";

const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v18.0";

type MetaDispatchResult = {
  success: boolean;
  status: "sent" | "skipped" | "failed";
  message: string;
  responsePayload?: Record<string, unknown>;
};

type MetaDispatchOptions = {
  testMode?: boolean;
  testEventCodeOverride?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

function clean(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function decryptStoredSecret(value: unknown) {
  const stored = clean(value);
  if (!stored || stored === "none") return "";
  return stored.startsWith("enc:v1:") ? decryptToken(stored.slice(7)) : stored;
}

function normalizeForHash(value: unknown, type = "text") {
  let output = clean(value).toLowerCase();

  if (!output) return "";

  if (type === "phone") {
    output = output.replace(/[^\d]/g, "");
  }

  return output;
}

function sha256(value: unknown, type = "text") {
  const normalized = normalizeForHash(value, type);

  if (!normalized) return undefined;

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function mapGa4ToMeta(eventName: string) {
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

function getMetaEventName(event: any) {
  return clean(event.meta_event) || mapGa4ToMeta(clean(event.event_name));
}

function getEventTime(event: any) {
  const value = event.event_time;

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  const n = Number(value);

  if (Number.isFinite(n)) {
    return n > 9999999999 ? Math.floor(n / 1000) : Math.floor(n);
  }

  return Math.floor(Date.now() / 1000);
}

function getMetaFromEvent(event: any) {
  return event.meta && typeof event.meta === "object" ? event.meta : {};
}

function getContentIds(event: any) {
  const meta = getMetaFromEvent(event);

  if (Array.isArray(meta.content_ids)) {
    return meta.content_ids.map((item: unknown) => clean(item)).filter(Boolean);
  }

  const ecommerce = event.ecommerce || {};

  if (Array.isArray(ecommerce.items)) {
    return ecommerce.items
      .map((item: any) => clean(item.id || item.item_id))
      .filter(Boolean);
  }

  return [];
}

function getContents(event: any) {
  const meta = getMetaFromEvent(event);

  if (Array.isArray(meta.contents)) {
    return meta.contents;
  }

  const ecommerce = event.ecommerce || {};

  if (Array.isArray(ecommerce.items)) {
    return ecommerce.items
      .map((item: any) => ({
        id: clean(item.id || item.item_id),
        quantity: Number(item.quantity || 1),
        item_price:
          item.item_price !== undefined
            ? Number(item.item_price)
            : item.price !== undefined
              ? Number(item.price)
              : undefined,
      }))
      .filter((item: any) => item.id);
  }

  return [];
}

function getCustomerValue(customer: any, key: string) {
  return customer && typeof customer === "object" ? customer[key] : undefined;
}

function getAddressValue(customer: any, key: string) {
  return customer && typeof customer.address === "object"
    ? customer.address[key]
    : undefined;
}

function getAttributionValue(attribution: any, key: string) {
  return attribution && typeof attribution === "object" ? attribution[key] : undefined;
}

function buildUserData(event: any, options: MetaDispatchOptions) {
  const customer = event.customer || {};
  const attribution = event.attribution || {};
  const raw = event.raw || {};

  const userData: Record<string, unknown> = {};

  const fields: Record<string, string | undefined> = {
    em: sha256(getCustomerValue(customer, "email")),
    ph: sha256(getCustomerValue(customer, "phone"), "phone"),
    fn: sha256(getCustomerValue(customer, "first_name")),
    ln: sha256(getCustomerValue(customer, "last_name")),
    ct: sha256(getAddressValue(customer, "city")),
    st: sha256(getAddressValue(customer, "state")),
    zp: sha256(getAddressValue(customer, "zip")),
    country: sha256(getAddressValue(customer, "country")),
    external_id: sha256(
      getCustomerValue(customer, "customer_id") ||
        getAttributionValue(attribution, "external_id") ||
        raw.external_id ||
        raw.customer_id
    ),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value) userData[key] = value;
  }

  const fbp = getAttributionValue(attribution, "fbp");
  const fbc = getAttributionValue(attribution, "fbc");

  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  if (options.clientIpAddress) userData.client_ip_address = options.clientIpAddress;
  if (options.clientUserAgent) userData.client_user_agent = options.clientUserAgent;

  return userData;
}

async function getMetaAccess(workspaceId: string) {
  const [datasetSelection, testEventCodeSelection, capiAccessTokenSelection] =
    await Promise.all([
      db.shopAssetSelection.findUnique({
        where: {
          workspaceId_platform_assetType: {
            workspaceId,
            platform: "meta",
            assetType: "Meta Dataset / Pixel",
          },
        },
        select: {
          assetValue: true,
        },
      }),
      db.shopAssetSelection.findUnique({
        where: {
          workspaceId_platform_assetType: {
            workspaceId,
            platform: "meta",
            assetType: "Meta Test Event Code",
          },
        },
        select: {
          assetValue: true,
        },
      }),
      db.shopAssetSelection.findUnique({
        where: {
          workspaceId_platform_assetType: {
            workspaceId,
            platform: "meta",
            assetType: "Meta CAPI Access Token",
          },
        },
        select: {
          assetValue: true,
        },
      }),
    ]);

  return {
    accessToken: decryptStoredSecret(capiAccessTokenSelection?.assetValue),
    pixelId: clean(datasetSelection?.assetValue),
    testEventCode:
      clean(testEventCodeSelection?.assetValue) === "none"
        ? ""
        : decryptStoredSecret(testEventCodeSelection?.assetValue),
  };
}

export async function dispatchToMeta(
  event: any,
  workspaceId: string,
  options: MetaDispatchOptions = {}
): Promise<MetaDispatchResult> {
  try {
    const { accessToken, pixelId, testEventCode } = await getMetaAccess(workspaceId);

    if (!accessToken || !pixelId) {
      return {
        success: false,
        status: "skipped",
        message: "Meta CAPI skipped. Missing manual Meta CAPI access token or Dataset / Pixel ID.",
      };
    }

    const eventName = getMetaEventName(event);
    const contentIds = getContentIds(event);
    const contents = getContents(event);
    const ecommerce = event.ecommerce || {};
    const raw = event.raw || {};
    const meta = getMetaFromEvent(event);

    const customData: Record<string, unknown> = {
      content_type: meta.content_type || "product",
    };

    if (contentIds.length) customData.content_ids = contentIds;
    if (contents.length) customData.contents = contents;

    if (contents.length) {
      customData.num_items = contents.reduce(
        (sum: number, item: any) => sum + Number(item.quantity || 1),
        0
      );
    }

    const value = ecommerce.value ?? raw.value;
    const currency = ecommerce.currency ?? raw.currency;

    if (value !== undefined && value !== null && value !== "") {
      customData.value = Number(value);
    }

    if (currency) {
      customData.currency = currency;
    }

    const orderId =
      ecommerce.transaction_id ||
      raw.transaction_id ||
      raw.order_id ||
      "";

    if (orderId) {
      customData.order_id = orderId;
    }

    const metaEvent = {
      event_name: eventName,
      event_time: getEventTime(event),
      event_id: event.event_id,
      action_source: "website",
      event_source_url: event.page_location || undefined,
      user_data: buildUserData(event, options),
      custom_data: customData,
    };

    const effectiveTestEventCode =
      clean(
        options
          .testEventCodeOverride,
      ) ||
      testEventCode ||
      "";

    const requestBody: Record<string, unknown> = {
      data: [metaEvent],
      access_token: accessToken,
    };

    if (effectiveTestEventCode) {
      requestBody.test_event_code = effectiveTestEventCode;
    }

    const response = await axios.post(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pixelId}/events`,
      requestBody,
      { timeout: 12000 }
    );

    return {
      success: true,
      status: "sent",
      message: `Meta CAPI sent ${eventName}.`,
      responsePayload: {
        pixelId,
        eventName,
        eventId: event.event_id,
        testEventCode:
          effectiveTestEventCode ||
          null,
        testMode:
          Boolean(
            effectiveTestEventCode,
          ),
        metaResponse:
          response.data,
      },
    };
  } catch (error: any) {
    const responseStatus =
      Number(
        error?.response?.status ||
        0,
      ) ||
      null;

    const metaError =
      error?.response?.data
        ?.error &&
      typeof error.response.data
        .error === "object"
        ? error.response.data
            .error
        : {};

    const message = responseStatus
      ? `Meta CAPI request failed with HTTP ${responseStatus}.`
      : error?.code === "ECONNABORTED"
        ? "Meta CAPI request timed out."
        : "Meta CAPI network request failed.";

    return {
      success: false,
      status: "failed",
      message: `Meta CAPI failed: ${message}`,
      responsePayload: {
        statusCode: responseStatus,
        errorCategory:
          responseStatus === 429
            ? "rate_limited"
            : responseStatus &&
                responseStatus >=
                  500
              ? "service_unavailable"
              : responseStatus
                ? "api_rejected"
                : "network_or_timeout",

        metaError: {
          type:
            clean(metaError.type) ||
            null,
          code:
            Number(
              metaError.code ||
              0,
            ) ||
            null,
          subcode:
            Number(
              metaError.error_subcode ||
              0,
            ) ||
            null,
          message:
            clean(
              metaError.message,
            ).slice(0, 500) ||
            null,
          traceId:
            clean(
              metaError.fbtrace_id,
            ) ||
            null,
        },
      },
    };
  }
}
