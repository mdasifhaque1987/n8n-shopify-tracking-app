type RateBucket = {
  count: number;
  resetAt: number;
};

type SecurityOk = {
  ok: true;
  payload: Record<string, unknown>;
  eventName: string;
  normalizedEventName: string;
};

type SecurityFail = {
  ok: false;
  response: Response;
};

type SecurityResult = SecurityOk | SecurityFail;

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 180;

const rateBuckets = new Map<string, RateBucket>();

const EVENT_ALIASES: Record<string, string> = {
  page_viewed: "page_view",
  product_viewed: "view_item",
  product_added_to_cart: "add_to_cart",
  checkout_started: "begin_checkout",
  checkout_completed: "purchase",
};

const ALLOWED_EVENTS = new Set([
  "page_view",
  "page_viewed",

  "view_item",
  "product_viewed",
  "view_item_list",
  "collection_viewed",

  "search",
  "search_submitted",
  "view_search_results",

  "add_to_cart",
  "product_added_to_cart",
  "cart_viewed",

  "begin_checkout",
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_address_info_submitted",
  "payment_info_submitted",

  "purchase",
  "checkout_completed",
  "add_payment_info",
  "add_shipping_info",
]);

const SENSITIVE_KEY_PATTERN =
  /(token|secret|authorization|password|api[_-]?key|developer[_-]?token|refresh[_-]?token|access[_-]?token|client[_-]?secret)/i;

const EMAIL_KEY_PATTERN = /email/i;
const PHONE_KEY_PATTERN = /phone|tel/i;
const ADDRESS_KEY_PATTERN =
  /address|street|city|state|province|zip|postal|country/i;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) return fallback;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function fail(
  message: string,
  status = 400,
  extraHeaders: Record<string, string> = {},
): SecurityFail {
  return {
    ok: false,
    response: jsonResponse(
      {
        ok: false,
        error: message,
      },
      status,
      extraHeaders,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;

    return current[key];
  }, obj);
}

function firstString(obj: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPath(obj, path);

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function firstNumber(obj: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    const value = getPath(obj, path);

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function getEventName(payload: Record<string, unknown>): string | null {
  const eventValue = payload.event;

  if (typeof eventValue === "string" && eventValue.trim()) {
    return eventValue.trim();
  }

  if (isRecord(eventValue)) {
    const nested = eventValue.name || eventValue.eventName || eventValue.event_name;

    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }

  return firstString(payload, [
    "eventName",
    "event_name",
    "name",
    "type",
    "shopifyEventName",
    "analyticsEventName",
  ]);
}

function normalizeEventName(eventName: string): string {
  return EVENT_ALIASES[eventName] || eventName;
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getRateLimitKey(request: Request, payload: Record<string, unknown>) {
  const ip = getClientIp(request);

  const shop =
    firstString(payload, ["shop", "shopDomain", "shop_domain", "context.shop"]) ||
    "unknown-shop";

  return `${ip}:${shop}`;
}

function checkPayloadSize(request: Request): SecurityFail | null {
  const maxPayloadBytes = numberFromEnv(
    "EVENT_MAX_PAYLOAD_BYTES",
    DEFAULT_MAX_PAYLOAD_BYTES,
  );

  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength && contentLength > maxPayloadBytes) {
    return fail("Payload too large.", 413);
  }

  return null;
}

function checkRateLimit(
  request: Request,
  payload: Record<string, unknown>,
): SecurityFail | null {
  const rateLimit = numberFromEnv(
    "EVENT_RATE_LIMIT_PER_MINUTE",
    DEFAULT_RATE_LIMIT_PER_MINUTE,
  );

  const now = Date.now();
  const key = getRateLimitKey(request, payload);
  const existing = rateBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, {
      count: 1,
      resetAt: now + 60_000,
    });

    return null;
  }

  existing.count += 1;

  if (existing.count > rateLimit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );

    return fail("Too many tracking requests. Please retry later.", 429, {
      "retry-after": String(retryAfterSeconds),
    });
  }

  return null;
}

function checkShopValue(payload: Record<string, unknown>): SecurityFail | null {
  const shop = firstString(payload, [
    "shop",
    "shopDomain",
    "shop_domain",
    "context.shop",
  ]);

  if (!shop) {
    return null;
  }

  if (
    shop.length > 255 ||
    shop.includes("://") ||
    shop.includes("/") ||
    shop.includes("\\") ||
    shop.includes("..")
  ) {
    return fail("Invalid shop value.", 400);
  }

  return null;
}

function checkPurchasePayload(payload: Record<string, unknown>): SecurityFail | null {
  const eventName = getEventName(payload);

  if (!eventName) {
    return null;
  }

  const normalizedEventName = normalizeEventName(eventName);

  if (normalizedEventName !== "purchase") {
    return null;
  }

  const transactionId = firstString(payload, [
    "transaction_id",
    "transactionId",
    "order_id",
    "orderId",
    "ecommerce.transaction_id",
    "ecommerce.transactionId",
    "checkout.order.id",
    "checkout.order.name",
    "data.transaction_id",
    "data.transactionId",
  ]);

  if (!transactionId) {
    return fail("Purchase event rejected because transaction_id is missing.", 400);
  }

  const value = firstNumber(payload, [
    "value",
    "total",
    "amount",
    "ecommerce.value",
    "ecommerce.total",
    "checkout.totalPrice.amount",
    "checkout.totalPrice",
    "data.value",
  ]);

  if (value !== null && value < 0) {
    return fail("Purchase event rejected because value cannot be negative.", 400);
  }

  const currency = firstString(payload, [
    "currency",
    "ecommerce.currency",
    "checkout.currencyCode",
    "data.currency",
  ]);

  if (currency && !/^[A-Z]{3}$/i.test(currency)) {
    return fail("Purchase event rejected because currency is invalid.", 400);
  }

  const items =
    getPath(payload, "items") ||
    getPath(payload, "ecommerce.items") ||
    getPath(payload, "data.items");

  if (Array.isArray(items) && items.length > 100) {
    return fail("Purchase event rejected because items array is too large.", 400);
  }

  return null;
}

function maskEmail(value: string) {
  const [name, domain] = value.split("@");

  if (!name || !domain) return "[redacted-email]";

  return `${name.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) return "[redacted-phone]";

  return `********${digits.slice(-4)}`;
}

export function sanitizeForEventLog(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeForEventLog(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[redacted-secret]";
      continue;
    }

    if (typeof childValue === "string" && EMAIL_KEY_PATTERN.test(key)) {
      output[key] = maskEmail(childValue);
      continue;
    }

    if (typeof childValue === "string" && PHONE_KEY_PATTERN.test(key)) {
      output[key] = maskPhone(childValue);
      continue;
    }

    if (ADDRESS_KEY_PATTERN.test(key)) {
      output[key] =
        typeof childValue === "string"
          ? "[redacted-address]"
          : sanitizeForEventLog(childValue, depth + 1);

      continue;
    }

    output[key] = sanitizeForEventLog(childValue, depth + 1);
  }

  return output;
}

export async function applyEventSecurityPrecheck(
  request: Request,
  payload: unknown,
): Promise<SecurityResult> {
  if (process.env.EVENT_SECURITY_PRECHECK_DISABLED === "true") {
    return {
      ok: true,
      payload: isRecord(payload) ? payload : {},
      eventName: "security_disabled",
      normalizedEventName: "security_disabled",
    };
  }

  const sizeCheck = checkPayloadSize(request);

  if (sizeCheck) {
    return sizeCheck;
  }

  if (!isRecord(payload)) {
    return fail("Invalid tracking payload.", 400);
  }

  const eventName = getEventName(payload);

  if (!eventName) {
    return fail("Tracking event name is missing.", 400);
  }

  const normalizedEventName = normalizeEventName(eventName);

  if (!ALLOWED_EVENTS.has(eventName) && !ALLOWED_EVENTS.has(normalizedEventName)) {
    return fail(`Tracking event is not allowed: ${eventName}`, 400);
  }

  const shopCheck = checkShopValue(payload);

  if (shopCheck) {
    return shopCheck;
  }

  const rateLimitCheck = checkRateLimit(request, payload);

  if (rateLimitCheck) {
    return rateLimitCheck;
  }

  const purchaseCheck = checkPurchasePayload(payload);

  if (purchaseCheck) {
    return purchaseCheck;
  }

  return {
    ok: true,
    payload,
    eventName,
    normalizedEventName,
  };
}
