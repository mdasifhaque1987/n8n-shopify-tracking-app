import type { NormalizedTrackingEvent } from "../normalize-event.server";
import { getGa4DeliverySettings } from "../ga4-delivery-settings.server";

export type Ga4DispatchResult = {
  success: boolean;
  status: "success" | "failed" | "skipped";
  message: string;
  responsePayload?: Record<string, unknown>;
};

export type Ga4DispatchOptions = {
  testMode?: boolean;
  debugMode?: boolean;
  validationOnly?: boolean;
};

function stringValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function nestedObjectValue(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return objectValue(source[key]);
}

function cleanObject<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      if (value.length) output[key] = value;
      continue;
    }

    if (value && typeof value === "object") {
      const nested = cleanObject(value as Record<string, unknown>);

      if (Object.keys(nested).length) {
        output[key] = nested;
      }

      continue;
    }

    output[key] = value;
  }

  return output;
}


function isGaStyleClientId(value?: string) {
  return Boolean(value && /^\d+\.\d+$/.test(value));
}

function hashToGaNumber(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const positive = hash >>> 0;

  return 100000000 + (positive % 1900000000);
}

function normalizeGaClientId(value: string | undefined, event: NormalizedTrackingEvent) {
  if (isGaStyleClientId(value)) {
    return value as string;
  }

  const source =
    value ||
    event.event_id ||
    String(event.event_time || "") ||
    `${Date.now()}-${Math.random()}`;

  const left = hashToGaNumber(source);
  const right = hashToGaNumber(`${source}:dh-ga4-client`);

  return `${left}.${right}`;
}


function getClientId(event: NormalizedTrackingEvent) {
  const raw = objectValue(event.raw);
  const rawRaw = nestedObjectValue(raw, "raw");
  const customer = objectValue(event.customer);
  const attribution = objectValue(event.attribution);

  const sourceClientId =
    stringValue(raw.client_id) ||
    stringValue(raw.clientId) ||
    stringValue(raw.ga_client_id) ||
    stringValue(raw.gaClientId) ||
    stringValue(rawRaw.client_id) ||
    stringValue(rawRaw.clientId) ||
    stringValue(rawRaw.ga_client_id) ||
    stringValue(rawRaw.gaClientId) ||
    stringValue(customer.client_id) ||
    stringValue(customer.external_id) ||
    stringValue(attribution.client_id) ||
    stringValue(attribution.ga_client_id) ||
    event.event_id ||
    undefined;

  return normalizeGaClientId(sourceClientId, event);
}

function getUserId(event: NormalizedTrackingEvent) {
  const customer = objectValue(event.customer);
  const raw = objectValue(event.raw);

  return (
    stringValue(customer.external_id) ||
    stringValue(customer.id) ||
    stringValue(raw.external_id) ||
    stringValue(raw.customer_id) ||
    undefined
  );
}

function mapItems(items: unknown) {
  if (!Array.isArray(items)) return undefined;

  return items.slice(0, 100).map((item) => {
    const row = objectValue(item);

    const itemId =
      stringValue(row.item_id) ||
      stringValue(row.id) ||
      stringValue(row.product_id) ||
      stringValue(row.variant_id) ||
      stringValue(row.sku);

    return cleanObject({
      id:
        stringValue(row.id) ||
        itemId,
      item_id: itemId,
      item_name:
        stringValue(row.item_name) ||
        stringValue(row.name) ||
        stringValue(row.product_title) ||
        stringValue(row.title),
      item_brand:
        stringValue(row.item_brand) ||
        stringValue(row.brand),
      product_id:
        stringValue(row.product_id) ||
        stringValue(row.productId),
      variant_id:
        stringValue(row.variant_id) ||
        stringValue(row.variantId),
      item_variant:
        stringValue(row.item_variant) ||
        stringValue(row.variant),
      item_category:
        stringValue(row.item_category) ||
        stringValue(row.category),
      price: numberValue(row.price),
      discount:
        numberValue(row.discount) ?? 0,
      quantity:
        numberValue(row.quantity) || 1,
    });
  });
}

function getSessionId(event: NormalizedTrackingEvent) {
  const raw = objectValue(event.raw);
  const rawRaw = nestedObjectValue(raw, "raw");
  const attribution = objectValue(event.attribution);

  return (
    stringValue(raw.session_id) ||
    stringValue(raw.sessionId) ||
    stringValue(raw.ga_session_id) ||
    stringValue(raw.gaSessionId) ||
    stringValue(rawRaw.session_id) ||
    stringValue(rawRaw.sessionId) ||
    stringValue(rawRaw.ga_session_id) ||
    stringValue(rawRaw.gaSessionId) ||
    stringValue(attribution.session_id) ||
    stringValue(attribution.ga_session_id) ||
    String(event.event_time || Math.floor(Date.now() / 1000))
  );
}

function buildGa4Params(event: NormalizedTrackingEvent, options: Ga4DispatchOptions) {
  const ecommerce = objectValue(event.ecommerce);
  const raw = objectValue(event.raw);
  const debugMode = Boolean(options.debugMode || options.testMode);

  return cleanObject({
    event_id: event.event_id,
    debug_mode: debugMode || undefined,
    session_id: getSessionId(event),

    page_location: event.page_location || stringValue(raw.page_location),
    page_title: event.page_title || stringValue(raw.page_title),
    page_referrer: event.page_referrer || stringValue(raw.page_referrer),

    currency: stringValue(ecommerce.currency) || stringValue(raw.currency),
    value: numberValue(ecommerce.value) ?? numberValue(raw.value),
    tax: numberValue(ecommerce.tax) ?? numberValue(raw.tax),
    shipping: numberValue(ecommerce.shipping) ?? numberValue(raw.shipping),
    transaction_id:
      stringValue(ecommerce.transaction_id) ||
      stringValue(raw.transaction_id) ||
      stringValue(raw.order_id),

    items: mapItems(ecommerce.items || raw.items),

    engagement_time_msec: 1,
  });
}

function buildGa4Body(event: NormalizedTrackingEvent, options: Ga4DispatchOptions) {
  const body = cleanObject({
    client_id: getClientId(event),
    user_id: getUserId(event),
    timestamp_micros: event.event_time
      ? Math.floor(Number(event.event_time) * 1000000)
      : undefined,
    events: [
      {
        name: event.event_name,
        params: buildGa4Params(event, options),
      },
    ],
  });

  return body;
}


async function postGa4WithTimeout(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 8000
): Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  timedOut?: boolean;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: Record<string, unknown> = {};

    try {
      payload = responseText
        ? (JSON.parse(responseText) as Record<string, unknown>)
        : {};
    } catch {
      payload = {
        rawResponse: responseText,
      };
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    const errorName =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";

    if (errorName === "AbortError") {
      return {
        ok: false,
        status: 0,
        timedOut: true,
        payload: {
          error: `GA4 request timed out after ${timeoutMs} seconds.`,
          timeoutMs,
        },
      };
    }

    return {
      ok: false,
      status: 0,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchToGA4(
  event: NormalizedTrackingEvent,
  workspaceId: string,
  options: Ga4DispatchOptions = {}
): Promise<Ga4DispatchResult> {
  try {
    const ga4Settings = await getGa4DeliverySettings(workspaceId, true);
    const setting = ga4Settings.setting;
    const credential = ga4Settings.credential;

    const serverSideEnabled =
      Boolean(setting?.serverSideEnabled) || setting?.deliveryMode === "server";

    if (!setting?.isActive || !serverSideEnabled) {
      return {
        success: false,
        status: "skipped",
        message: "GA4 server-side delivery is not enabled.",
        responsePayload: {
          mode: options.testMode ? "test" : "live",
          testMode: Boolean(options.testMode),
          serverSideEnabled,
          deliveryMode: setting?.deliveryMode || "not_configured",
        },
      };
    }

    const measurementId = stringValue(credential?.assetId);
    const apiSecret = stringValue(credential?.apiSecret);

    if (!measurementId) {
      return {
        success: false,
        status: "failed",
        message: "GA4 Measurement ID is not configured.",
        responsePayload: {
          mode: options.testMode ? "test" : "live",
          testMode: Boolean(options.testMode),
        },
      };
    }

    if (!apiSecret) {
      return {
        success: false,
        status: "failed",
        message: "GA4 API Secret is not configured for server-side delivery.",
        responsePayload: {
          mode: options.testMode ? "test" : "live",
          testMode: Boolean(options.testMode),
          measurementId,
          hasApiSecret: false,
        },
      };
    }

    const collectEndpoint = new URL("https://www.google-analytics.com/mp/collect");
    const debugEndpoint = new URL("https://www.google-analytics.com/debug/mp/collect");

    collectEndpoint.searchParams.set("measurement_id", measurementId);
    collectEndpoint.searchParams.set("api_secret", apiSecret);

    debugEndpoint.searchParams.set("measurement_id", measurementId);
    debugEndpoint.searchParams.set("api_secret", apiSecret);

    const body = buildGa4Body(event, options);

    const validationResult = options.validationOnly
      ? await postGa4WithTimeout(debugEndpoint.toString(), body)
      : null;

    const collectResult = options.validationOnly
      ? null
      : await postGa4WithTimeout(collectEndpoint.toString(), body);

    const safePayload = {
      ...(collectResult?.payload || {}),
      mode: options.testMode ? "test" : "live",
      testMode: Boolean(options.testMode),
      debugMode: Boolean(options.debugMode || options.testMode),
      measurementId,
      statusCode: collectResult?.status || validationResult?.status,
      validationOnly: Boolean(options.validationOnly),
      eventName: event.event_name,
      eventId: event.event_id,
      validationStatusCode: validationResult?.status,
      validationMessages: validationResult?.payload?.validationMessages || [],
      validationPayload: validationResult?.payload || null,
      requestBodyPreview: {
        client_id: body.client_id,
        user_id_present: Boolean(body.user_id),
        events: Array.isArray(body.events)
          ? body.events.map((item) => {
              const row = item as { name?: unknown; params?: Record<string, unknown> };
              return {
                name: row.name,
                debug_mode: row.params?.debug_mode,
                session_id: row.params?.session_id,
                transaction_id: row.params?.transaction_id,
                value: row.params?.value,
                currency: row.params?.currency,
                items_count: Array.isArray(row.params?.items) ? row.params.items.length : 0,
              };
            })
          : [],
      },
    };

    if (options.validationOnly) {
      const messages = validationResult?.payload?.validationMessages;
      const invalid = Array.isArray(messages) && messages.length > 0;
      return {
        success: Boolean(validationResult?.ok) && !invalid,
        status: validationResult?.ok && !invalid ? "success" : "failed",
        message: validationResult?.ok && !invalid
          ? "GA4 payload validated only; it was not delivered to reports."
          : "GA4 validation-only request returned validation errors.",
        responsePayload: safePayload,
      };
    }

    if (!collectResult?.ok) {
      return {
        success: false,
        status: "failed",
        message: collectResult?.timedOut
          ? "GA4 Measurement Protocol request timed out after 8 seconds."
          : `GA4 Measurement Protocol failed with status ${collectResult?.status || 0}.`,
        responsePayload: safePayload,
      };
    }

    return {
      success: true,
      status: "success",
      message: options.testMode
        ? "GA4 event sent with debug_mode enabled."
        : "GA4 event sent successfully.",
      responsePayload: safePayload,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      responsePayload: {
        mode: options.testMode ? "test" : "live",
        testMode: Boolean(options.testMode),
      },
    };
  }
}
