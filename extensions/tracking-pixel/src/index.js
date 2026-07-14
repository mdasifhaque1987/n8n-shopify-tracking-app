import { register } from "@shopify/web-pixels-extension";

const CONFIG_URL = "https://tracking.datahatches.com/api/pixel-config";
const APP_PROXY_TRACK_URL = "/apps/dh-track";
const TRACK_URL = "https://tracking.datahatches.com/api/events/track";
const GA4_COLLECT_URL = "https://www.google-analytics.com/g/collect";
const GOOGLE_ADS_CONVERSION_URL = "https://www.googleadservices.com/pagead/conversion";
const META_PIXEL_URL = "https://www.facebook.com/tr/";

const DH_GA_CLIENT_ID_KEY = "dh_ga4_client_id";
const DH_GA_SESSION_ID_KEY = "dh_ga4_session_id";
const DH_GA_SESSION_TS_KEY = "dh_ga4_session_ts";
const DH_GA_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DH_PIXEL_VERSION = "2026-07-05-app-proxy-fallback-v5";
const DH_PIXEL_DEBUG = false;

let cachedConfig = null;
let metaSemanticMemory = {};

async function getConfig(shop) {
  if (cachedConfig) return cachedConfig;

  const res = await fetch(`${CONFIG_URL}?shop=${encodeURIComponent(shop || "")}`, {
    method: "GET",
    keepalive: true,
  });

  cachedConfig = await res.json();
  return cachedConfig;
}

function getShop(event) {
  try {
    return event.context.window.location.hostname || "";
  } catch (e) {
    return "";
  }
}


function isGaStyleClientId(value) {
  return typeof value === "string" && /^\d+\.\d+$/.test(value);
}

function createGaStyleClientId() {
  var first = Math.floor(100000000 + Math.random() * 900000000);
  var second = Math.floor(Date.now() / 1000);

  return String(first) + "." + String(second);
}

async function storageGet(browser, key) {
  try {
    if (
      browser &&
      browser.localStorage &&
      typeof browser.localStorage.getItem === "function"
    ) {
      return await browser.localStorage.getItem(key);
    }
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] storage get error", key, e);
  }

  return null;
}

async function storageSet(browser, key, value) {
  try {
    if (
      browser &&
      browser.localStorage &&
      typeof browser.localStorage.setItem === "function"
    ) {
      await browser.localStorage.setItem(key, String(value));
      return true;
    }
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] storage set error", key, e);
  }

  return false;
}

async function getOrCreateGaClientId(browser, fallbackClientId) {
  var stored = await storageGet(browser, DH_GA_CLIENT_ID_KEY);

  if (isGaStyleClientId(stored)) {
    return stored;
  }

  if (isGaStyleClientId(fallbackClientId)) {
    await storageSet(browser, DH_GA_CLIENT_ID_KEY, fallbackClientId);
    return fallbackClientId;
  }

  var generated = createGaStyleClientId();

  await storageSet(browser, DH_GA_CLIENT_ID_KEY, generated);

  return generated;
}

async function getOrCreateGaSessionId(browser) {
  var nowMs = Date.now();
  var nowSeconds = Math.floor(nowMs / 1000);
  var storedSessionId = await storageGet(browser, DH_GA_SESSION_ID_KEY);
  var storedSessionTs = Number(await storageGet(browser, DH_GA_SESSION_TS_KEY) || 0);
  var isExpired =
    !storedSessionId ||
    !storedSessionTs ||
    nowMs - storedSessionTs > DH_GA_SESSION_TIMEOUT_MS;

  var sessionId = isExpired ? String(nowSeconds) : String(storedSessionId);

  await storageSet(browser, DH_GA_SESSION_ID_KEY, sessionId);
  await storageSet(browser, DH_GA_SESSION_TS_KEY, String(nowMs));

  return sessionId;
}

async function getGaIdentity(browser, event) {
  var fallbackClientId = event && event.clientId ? String(event.clientId) : "";
  var clientId = await getOrCreateGaClientId(browser, fallbackClientId);
  var sessionId = await getOrCreateGaSessionId(browser);

  return {
    clientId: clientId,
    sessionId: sessionId,
    shopifyClientId: fallbackClientId,
  };
}


function getAppProxyTrackUrls(payload) {
  try {
    const pageLocation = payload && payload.page_location ? String(payload.page_location) : "";
    if (pageLocation) {
      const origin = new URL(pageLocation).origin;
      return [`${origin}${APP_PROXY_TRACK_URL}`];
    }
  } catch (e) {
    // Fall back to relative path only if page_location is unavailable.
  }

  return [APP_PROXY_TRACK_URL];
}

function isMetaCheckoutFallbackEvent(payload) {
  return (
    payload &&
    (
      payload.meta_event === "AddPaymentInfo" ||
      payload.meta_event === "AddShippingInfo"
    )
  );
}

async function sendToServerTextFallback(payload) {
  try {
    await fetch(TRACK_URL, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify({
        ...payload,
        transport: "text_plain_checkout_fallback",
      }),
    });

    DH_PIXEL_DEBUG && console.log(
      "[DH Tracking Pixel] checkout fallback server send attempted",
      payload.meta_event,
      payload.event_id
    );
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] checkout fallback send error", e);
  }
}

async function sendToServer(payload) {
  try {
    const body = JSON.stringify(payload);
    const appProxyUrls = getAppProxyTrackUrls(payload);

    // Send direct server endpoint first for checkout step reliability.
    // App proxy is kept only as fallback.
    const endpoints = [TRACK_URL].concat(appProxyUrls).filter(Boolean);
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body,
        });

        if (response.ok || response.type === "opaque") {
          DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] server sent", endpoint);
          return true;
        }

        lastError = new Error(`HTTP ${response.status} from ${endpoint}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] server send error", lastError);
    }

    return false;
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] server send error", e);
    return false;
  }
}

function mapEvent(name) {
  const map = {
    page_viewed: {
      ga4: "page_view",
      meta: "PageView",
    },
    collection_viewed: {
      ga4: "view_item_list",
      meta: "ViewContent",
    },
    product_viewed: {
      ga4: "view_item",
      meta: "ViewContent",
    },
    product_added_to_cart: {
      ga4: "add_to_cart",
      meta: "AddToCart",
    },
    product_removed_from_cart: {
      ga4: "remove_from_cart",
      meta: "RemoveFromCart",
    },
    cart_viewed: {
      ga4: "view_cart",
      meta: "ViewContent",
    },
    checkout_started: {
      ga4: "begin_checkout",
      meta: "InitiateCheckout",
    },
    checkout_contact_info_submitted: {
      ga4: "add_contact_info",
      meta: "Lead",
    },
    checkout_shipping_info_submitted: {
      ga4: "add_shipping_info",
      meta: "AddShippingInfo",
    },
    payment_info_submitted: {
      ga4: "add_payment_info",
      meta: "AddPaymentInfo",
    },
    checkout_completed: {
      ga4: "purchase",
      meta: "Purchase",
    },
    search_submitted: {
      ga4: "search",
      meta: "Search",
    },
  };

  return map[name] || {
    ga4: name,
    meta: name,
  };
}

function cleanMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeString(value) {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

const ATTRIBUTION_STORAGE_KEY = "dh_tracking_attribution";
const CUSTOMER_STORAGE_KEY = "dh_tracking_customer";
const DH_META_SEMANTIC_DEDUP_KEY = "dh_meta_semantic_dedup_v2";

const CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "ttclid",
  "epik",
];

function getUrlParam(url, key) {
  try {
    return new URL(url).searchParams.get(key) || undefined;
  } catch (e) {
    return undefined;
  }
}

async function readBrowserLocalStorage(browser, key) {
  try {
    if (
      browser &&
      browser.localStorage &&
      typeof browser.localStorage.getItem === "function"
    ) {
      return await browser.localStorage.getItem(key);
    }
  } catch (e) {
    // Ignore unavailable Shopify sandbox storage APIs.
  }

  return undefined;
}

async function readBrowserCookie(browser, key) {
  try {
    if (
      browser &&
      browser.cookie &&
      typeof browser.cookie.get === "function"
    ) {
      return await browser.cookie.get(key);
    }
  } catch (e) {
    // Ignore unavailable Shopify sandbox storage APIs.
  }

  return undefined;
}

async function writeBrowserLocalStorage(browser, key, value) {
  try {
    if (
      browser &&
      browser.localStorage &&
      typeof browser.localStorage.setItem === "function"
    ) {
      await browser.localStorage.setItem(key, value);
    }
  } catch (e) {
    // Ignore unavailable Shopify sandbox storage APIs.
  }
}

async function writeBrowserCookie(browser, key, value) {
  try {
    if (
      browser &&
      browser.cookie &&
      typeof browser.cookie.set === "function"
    ) {
      await browser.cookie.set(key, value);
    }
  } catch (e) {
    // Ignore unavailable Shopify sandbox storage APIs.
  }
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (e) {
    return {};
  }
}

async function getAttribution(event, browser) {
  const href = event.context?.window?.location?.href || "";
  const attribution = {};
  const urlClickIds = {};

  const urlParamAliases = {
    gclid: ["gclid", "dhgcl"],
    gbraid: ["gbraid", "dhgbra"],
    wbraid: ["wbraid", "dhwbra"],
    msclkid: ["msclkid", "dhclkid"],
    fbclid: ["fbclid", "dhclid"],
    ttclid: ["ttclid", "dhclid"],
    epik: ["epik"],
  };

  function getClickIdFromUrl(key) {
    const aliases = urlParamAliases[key] || [key];

    for (const alias of aliases) {
      const value = getUrlParam(href, alias);

      if (value) {
        return value;
      }
    }

    return undefined;
  }

  const storedRaw = await readBrowserLocalStorage(browser, ATTRIBUTION_STORAGE_KEY);
  const stored = parseJson(storedRaw);
  stored.click_ids = stored.click_ids || {};
  stored.page = stored.page || {};

  let changed = false;

  CLICK_ID_KEYS.forEach((key) => {
    const urlValue = getClickIdFromUrl(key);

    if (urlValue) {
      attribution[key] = urlValue;
      urlClickIds[key] = urlValue;
      stored.click_ids[key] = urlValue;
      changed = true;
    }
  });

  for (const key of CLICK_ID_KEYS) {
    if (!attribution[key] && stored.click_ids[key]) {
      attribution[key] = stored.click_ids[key];
    }

    if (!attribution[key]) {
      const cookieValue =
        await readBrowserCookie(browser, "dh_" + key) ||
        await readBrowserCookie(browser, key);

      if (cookieValue) {
        attribution[key] = cookieValue;
        stored.click_ids[key] = cookieValue;
        changed = true;
      }
    }
  }

  if (!stored.page.landing_page && href) {
    stored.page.landing_page = href;
    changed = true;
  }

  stored.page.page_location = href || undefined;
  stored.page.page_referrer = event.context?.document?.referrer || undefined;
  stored.page.page_title = event.context?.document?.title || undefined;
  stored.updated_at = Date.now();

  attribution.landing_page = stored.page.landing_page;
  attribution.first_page_referrer = stored.page.page_referrer;
  attribution.page_location = href || undefined;
  attribution.page_referrer = event.context?.document?.referrer || undefined;

  if (changed || Object.keys(urlClickIds).length) {
    await writeBrowserLocalStorage(browser, ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));

    for (const key of Object.keys(urlClickIds)) {
      await writeBrowserCookie(browser, "dh_" + key, urlClickIds[key]);
    }
  }

  const fbp = await readBrowserCookie(browser, "_fbp");
  const existingFbc = await readBrowserCookie(browser, "_fbc");

  if (fbp) {
    attribution.fbp = fbp;
  }

  if (existingFbc) {
    attribution.fbc = existingFbc;
  } else if (attribution.fbclid) {
    attribution.fbc = "fb.1." + Math.floor(Date.now() / 1000) + "." + attribution.fbclid;
    await writeBrowserCookie(browser, "_fbc", attribution.fbc);
  }

  return attribution;
}

function firstValue() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function getPathValue(source, path) {
  try {
    var parts = path.split(".");
    var current = source;

    for (var i = 0; i < parts.length; i += 1) {
      if (current === undefined || current === null) return undefined;
      current = current[parts[i]];
    }

    return firstValue(current);
  } catch (e) {
    return undefined;
  }
}

function findDeepValue(source, keys) {
  var seen = [];

  function walk(value) {
    if (!value || typeof value !== "object") return undefined;

    if (seen.indexOf(value) !== -1) return undefined;
    seen.push(value);

    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];

      if (
        Object.prototype.hasOwnProperty.call(value, key) &&
        value[key] !== undefined &&
        value[key] !== null &&
        String(value[key]).trim() !== ""
      ) {
        return value[key];
      }
    }

    var objectKeys = Object.keys(value);

    for (var j = 0; j < objectKeys.length; j += 1) {
      var result = walk(value[objectKeys[j]]);

      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  return walk(source);
}

function normalizeAddress(address) {
  address = address || {};

  return {
    address1: firstValue(
      address.address1,
      address.address_line_1,
      address.line1,
      address.street,
      address.streetAddress
    ),
    address2: firstValue(
      address.address2,
      address.address_line_2,
      address.line2,
      address.apartment,
      address.company
    ),
    city: firstValue(address.city, address.locality),
    state: firstValue(
      address.province,
      address.provinceCode,
      address.state,
      address.stateCode,
      address.region
    ),
    zip: firstValue(
      address.zip,
      address.postalCode,
      address.postal_code,
      address.postcode
    ),
    country: firstValue(
      address.country,
      address.countryCode,
      address.country_code
    ),
  };
}

function getAddress(checkout) {
  return normalizeAddress(
    firstValue(
      checkout.shippingAddress,
      checkout.billingAddress,
      checkout.deliveryAddress,
      checkout.address
    ) || {}
  );
}

function splitName(name) {
  name = firstValue(name);

  if (!name) {
    return {
      first_name: undefined,
      last_name: undefined,
    };
  }

  var parts = String(name).trim().split(/\s+/);

  return {
    first_name: parts[0],
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

function getCustomer(data) {
  var checkout = data.checkout || {};
  var customer = checkout.customer || data.customer || {};
  var shippingAddress = checkout.shippingAddress || {};
  var billingAddress = checkout.billingAddress || {};
  var deliveryAddress = checkout.deliveryAddress || {};
  var address = getAddress(checkout);

  var fullName = firstValue(
    customer.name,
    checkout.name,
    checkout.customerName,
    shippingAddress.name,
    billingAddress.name,
    deliveryAddress.name
  );

  var split = splitName(fullName);

  var email = firstValue(
    checkout.email,
    checkout.contactEmail,
    checkout.customerEmail,
    customer.email,
    getPathValue(checkout, "buyerIdentity.email"),
    getPathValue(checkout, "contact.email"),
    getPathValue(checkout, "contactInfo.email"),
    findDeepValue(checkout, ["email", "emailAddress", "contactEmail"])
  );

  var phone = firstValue(
    checkout.phone,
    checkout.customerPhone,
    customer.phone,
    shippingAddress.phone,
    billingAddress.phone,
    deliveryAddress.phone,
    getPathValue(checkout, "contact.phone"),
    getPathValue(checkout, "contactInfo.phone"),
    findDeepValue(checkout, ["phone", "phoneNumber", "mobile"])
  );

  var firstName = firstValue(
    customer.firstName,
    customer.first_name,
    checkout.firstName,
    checkout.first_name,
    shippingAddress.firstName,
    shippingAddress.first_name,
    billingAddress.firstName,
    billingAddress.first_name,
    deliveryAddress.firstName,
    deliveryAddress.first_name,
    split.first_name,
    findDeepValue(checkout, ["firstName", "first_name"])
  );

  var lastName = firstValue(
    customer.lastName,
    customer.last_name,
    checkout.lastName,
    checkout.last_name,
    shippingAddress.lastName,
    shippingAddress.last_name,
    billingAddress.lastName,
    billingAddress.last_name,
    deliveryAddress.lastName,
    deliveryAddress.last_name,
    split.last_name,
    findDeepValue(checkout, ["lastName", "last_name"])
  );

  var customerId = firstValue(
    customer.id,
    checkout.customerId,
    checkout.customer_id,
    getPathValue(checkout, "customer.id"),
    getPathValue(checkout, "buyerIdentity.customer.id"),
    findDeepValue(checkout, ["customerId", "customer_id"])
  );

  return {
    email: email,
    phone: phone,
    first_name: firstName,
    last_name: lastName,
    customer_id: customerId,
    address: address,
  };
}

function mergeAddress(storedAddress, currentAddress) {
  storedAddress = storedAddress || {};
  currentAddress = currentAddress || {};

  return {
    address1: firstValue(currentAddress.address1, storedAddress.address1),
    address2: firstValue(currentAddress.address2, storedAddress.address2),
    city: firstValue(currentAddress.city, storedAddress.city),
    state: firstValue(currentAddress.state, storedAddress.state),
    zip: firstValue(currentAddress.zip, storedAddress.zip),
    country: firstValue(currentAddress.country, storedAddress.country),
  };
}

function mergeCustomer(storedCustomer, currentCustomer) {
  storedCustomer = storedCustomer || {};
  currentCustomer = currentCustomer || {};

  return {
    email: firstValue(currentCustomer.email, storedCustomer.email),
    phone: firstValue(currentCustomer.phone, storedCustomer.phone),
    first_name: firstValue(currentCustomer.first_name, storedCustomer.first_name),
    last_name: firstValue(currentCustomer.last_name, storedCustomer.last_name),
    customer_id: firstValue(currentCustomer.customer_id, storedCustomer.customer_id),
    address: mergeAddress(storedCustomer.address, currentCustomer.address),
  };
}

function hasCustomerData(customer) {
  if (!customer) return false;

  if (
    firstValue(
      customer.email,
      customer.phone,
      customer.first_name,
      customer.last_name,
      customer.customer_id
    )
  ) {
    return true;
  }

  var address = customer.address || {};

  return !!firstValue(
    address.address1,
    address.address2,
    address.city,
    address.state,
    address.zip,
    address.country
  );
}

async function getCustomerForEvent(data, browser) {
  var currentCustomer = getCustomer(data);
  var storedRaw = await readBrowserLocalStorage(browser, CUSTOMER_STORAGE_KEY);
  var storedCustomer = parseJson(storedRaw);

  var mergedCustomer = mergeCustomer(storedCustomer, currentCustomer);

  if (hasCustomerData(mergedCustomer)) {
    await writeBrowserLocalStorage(browser, CUSTOMER_STORAGE_KEY, mergedCustomer);
  }

  return mergedCustomer;
}

function getEcommerce(data, value, currency, transactionId, items) {
  const checkout = data.checkout || {};

  return {
    transaction_id: transactionId,
    value,
    currency,
    items,
    shipping: cleanMoney(
      checkout.shippingLine?.price?.amount ||
      checkout.totalShippingPrice?.amount
    ),
    tax: cleanMoney(checkout.totalTax?.amount),
    coupon: Array.isArray(checkout.discountApplications)
      ? checkout.discountApplications
          .map((item) => item.title || item.code)
          .filter(Boolean)
          .join(",")
      : undefined,
  };
}

function getItems(data) {
  const checkout = data.checkout || {};
  const cartLine = data.cartLine || {};
  const productVariant = data.productVariant || cartLine.merchandise || {};
  const product = productVariant.product || {};

  if (Array.isArray(checkout.lineItems)) {
    return checkout.lineItems.map((line) => {
      const variant = line.variant || line.merchandise || {};
      const lineProduct = variant.product || {};
      return {
        item_id: safeString(variant.id || lineProduct.id || line.id),
        item_name: lineProduct.title || variant.title || line.title,
        product_id: safeString(lineProduct.id),
        variant_id: safeString(variant.id),
        sku: safeString(variant.sku || line.sku),
        price: cleanMoney(line.finalLinePrice?.amount || line.cost?.totalAmount?.amount || variant.price?.amount),
        quantity: cleanMoney(line.quantity) || 1,
      };
    });
  }

  const itemId = productVariant.id || product.id || cartLine.merchandise?.id;
  const itemName = product.title || productVariant.title || cartLine.merchandise?.title;

  if (!itemId && !itemName) return [];

  return [
    {
      item_id: safeString(itemId),
      item_name: itemName,
      product_id: safeString(product.id),
      variant_id: safeString(productVariant.id || cartLine.merchandise?.id),
      sku: safeString(productVariant.sku || cartLine.merchandise?.sku),
      price: cleanMoney(productVariant.price?.amount || cartLine.cost?.totalAmount?.amount),
      quantity: cleanMoney(cartLine.quantity) || 1,
    },
  ];
}

async function buildPayload(event, config, browser) {
  const mapped = mapEvent(event.name);
  const data = event.data || {};
  const checkout = data.checkout || {};
  const cartLine = data.cartLine || {};
  const productVariant = data.productVariant || cartLine.merchandise || {};
  const product = productVariant.product || {};

  const value =
    cleanMoney(checkout.totalPrice?.amount) ||
    cleanMoney(cartLine.cost?.totalAmount?.amount) ||
    cleanMoney(productVariant.price?.amount);

  const currency =
    checkout.currencyCode ||
    checkout.totalPrice?.currencyCode ||
    cartLine.cost?.totalAmount?.currencyCode ||
    productVariant.price?.currencyCode;

  const itemId =
    productVariant.id ||
    product.id ||
    cartLine.merchandise?.id ||
    undefined;

  const transactionId = checkout.order?.id || checkout.token || undefined;
  const items = getItems(data);
  const attribution = await getAttribution(event, browser);
  const customer = await getCustomerForEvent(data, browser);
  const ecommerce = getEcommerce(data, value, currency, transactionId, items);
  const metaContentIdFormat =
    config?.meta?.contentIdFormat || "shopify_country_product_variant";
  const metaContents = buildMetaContents(items, metaContentIdFormat);
  const metaContentIds = metaContents.map((item) => item.id).filter(Boolean);
  const gaIdentity = await getGaIdentity(browser, event);

  DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA identity", {
    pixelVersion: DH_PIXEL_VERSION,
    clientId: gaIdentity.clientId,
    sessionId: gaIdentity.sessionId,
    shopifyClientId: gaIdentity.shopifyClientId,
  });

  return {
    event_id: event.id,
    pixel_version: DH_PIXEL_VERSION,
    shop: getShop(event),
    original_event: event.name,
    event_name: mapped.ga4,
    ga4_event: mapped.ga4,
    meta_event: mapped.meta,
    client_id: gaIdentity.clientId,
    session_id: gaIdentity.sessionId,
    shopify_client_id: gaIdentity.shopifyClientId,
    timestamp: event.timestamp,
    event_time: event.timestamp,
    page_location: event.context?.window?.location?.href,
    page_title: event.context?.document?.title,
    page_referrer: event.context?.document?.referrer,
    value,
    currency,
    transaction_id: transactionId,
    content_ids: metaContentIds.length ? metaContentIds : itemId ? [String(itemId)] : undefined,
    item_name: product.title || productVariant.title || undefined,
    items,
    attribution,
    customer,
    ecommerce,
    meta: {
      event_name: mapped.meta,
      content_type: metaContents.length ? "product" : undefined,
      content_ids: metaContentIds,
      contents: metaContents,
    },
    config,
    raw: {
      client_id: gaIdentity.clientId,
      session_id: gaIdentity.sessionId,
      shopify_client_id: gaIdentity.shopifyClientId,
      pixel_version: DH_PIXEL_VERSION,
      checkout_token: checkout.token || undefined,
      checkout_id: checkout.id || undefined,
    },
  };
}

function addParam(params, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    params.set(key, String(value));
  }
}

function buildGa4Url(payload, measurementId) {
  const params = new URLSearchParams();

  params.set("v", "2");
  params.set("tid", measurementId);
  params.set("cid", payload.client_id || "dh_client");

  if (payload.session_id) {
    params.set("sid", String(payload.session_id));
  }

  params.set("en", payload.ga4_event || payload.original_event);
  params.set("_p", String(Date.now()));
  params.set("seg", "1");
  params.set("dl", payload.page_location || "");
  params.set("dt", payload.page_title || "");
  params.set("dr", payload.page_referrer || "");
  params.set("sr", "1920x1080");
  params.set("ul", "en-us");

  addParam(params, "ep.event_id", payload.event_id);
  addParam(params, "ep.session_id", payload.session_id);
  addParam(params, "ep.original_event", payload.original_event);

  if (payload.currency) {
    addParam(params, "cu", payload.currency);
  }

  if (payload.value !== undefined) {
    addParam(params, "epn.value", payload.value);
    addParam(params, "ep.value", payload.value);
  }

  if (payload.transaction_id) {
    addParam(params, "ep.transaction_id", payload.transaction_id);
    addParam(params, "ti", payload.transaction_id);
  }

  if (payload.items && payload.items.length) {
    payload.items.slice(0, 10).forEach((item, index) => {
      const n = index + 1;
      addParam(params, `pr${n}id`, item.item_id);
      addParam(params, `pr${n}nm`, item.item_name);
      addParam(params, `pr${n}pr`, item.price);
      addParam(params, `pr${n}qt`, item.quantity);
    });
  }

  return `${GA4_COLLECT_URL}?${params.toString()}`;
}



function mapGoogleAdsEventName(payload) {
  const map = {
    page_view: "PAGE_VIEW",
    view_item: "VIEW_ITEM",
    view_item_list: "VIEW_ITEM_LIST",
    add_to_cart: "ADD_TO_CART",
    begin_checkout: "BEGIN_CHECKOUT",
    purchase: "PURCHASE",
    generate_lead: "LEAD",
    sign_up: "SUBSCRIBE",
  };

  return map[payload.ga4_event] || map[payload.original_event] || String(payload.ga4_event || "").toUpperCase();
}


function buildGoogleAdsUrl(payload, conversion) {
  const conversionId = String(conversion.conversionId || "").replace(/^AW-/, "");
  const label = conversion.conversionLabel;

  const params = new URLSearchParams();

  params.set("label", label);
  params.set("guid", "ON");
  params.set("script", "0");

  if (payload.value !== undefined && payload.value !== null) {
    params.set("value", String(payload.value));
  }

  if (payload.currency) {
    params.set("currency_code", String(payload.currency));
  }

  if (payload.transaction_id) {
    params.set("transaction_id", String(payload.transaction_id));
  }


  return `${GOOGLE_ADS_CONVERSION_URL}/${encodeURIComponent(conversionId)}/?${params.toString()}`;
}


function normalizeRemarketingEventName(payload) {
  return String(payload.ga4_event || payload.original_event || "").trim();
}

function getRemarketingPageType(eventName) {
  const map = {
    page_view: "home",
    view_item: "product",
    view_item_list: "category",
    search: "searchresults",
    add_to_cart: "cart",
    begin_checkout: "cart",
    purchase: "purchase",
  };

  return map[eventName] || "other";
}

function getFirstItem(payload) {
  if (Array.isArray(payload.items) && payload.items.length) {
    return payload.items[0] || {};
  }

  return {};
}

function buildRemarketingProductId(item, itemIdFormat) {
  const productId =
    item.product_id ||
    item.item_group_id ||
    item.id ||
    item.item_id ||
    "";

  const variantId =
    item.variant_id ||
    item.variantId ||
    item.sku ||
    "";

  if (itemIdFormat === "product_id") {
    return String(productId || item.item_id || "").trim();
  }

  if (itemIdFormat === "variant_id") {
    return String(variantId || item.item_id || "").trim();
  }

  if (itemIdFormat === "sku") {
    return String(item.sku || variantId || item.item_id || "").trim();
  }

  if (itemIdFormat === "product_variant") {
    if (productId && variantId) return `${productId}_${variantId}`;
    return String(item.item_id || productId || variantId || "").trim();
  }

  if (itemIdFormat === "shopify_country_product_variant") {
    const country = String(payloadCountryFallback(item) || "US").toUpperCase();
    if (productId && variantId) return `shopify_${country}_${productId}_${variantId}`;
    return String(item.item_id || productId || variantId || "").trim();
  }

  return String(item.item_id || productId || variantId || "").trim();
}

function payloadCountryFallback(item) {
  return (
    item.country ||
    item.item_country ||
    item.currency_country ||
    "US"
  );
}

function buildGoogleAdsRemarketingUrl(payload, remarketingConfig) {
  const conversionId = String(
    remarketingConfig.conversionId ||
    remarketingConfig.googleAdsCustomerId ||
    ""
  ).replace(/^AW-/, "");

  const eventName = normalizeRemarketingEventName(payload);
  const item = getFirstItem(payload);
  const itemIdFormat = remarketingConfig.itemIdFormat || "shopify_country_product_variant";
  const productId = buildRemarketingProductId(item, itemIdFormat);
  const pageType = getRemarketingPageType(eventName);

  const params = new URLSearchParams();

  params.set("guid", "ON");
  params.set("script", "0");
  params.set("random", String(Date.now()));
  params.set("url", payload.page_location || "");
  params.set("ref", payload.page_referrer || "");

  if (payload.value !== undefined && payload.value !== null) {
    params.set("value", String(payload.value));
  }

  if (payload.currency) {
    params.set("currency_code", String(payload.currency));
  }

  const customParams = [];

  customParams.push(`event=${encodeURIComponent(eventName)}`);
  customParams.push(`ecomm_pagetype=${encodeURIComponent(pageType)}`);

  if (productId) {
    customParams.push(`ecomm_prodid=${encodeURIComponent(productId)}`);
  }

  if (payload.value !== undefined && payload.value !== null) {
    customParams.push(`ecomm_totalvalue=${encodeURIComponent(String(payload.value))}`);
  }

  if (payload.transaction_id) {
    customParams.push(`transaction_id=${encodeURIComponent(String(payload.transaction_id))}`);
  }

  params.set("data", customParams.join(";"));

  return `https://googleads.g.doubleclick.net/pagead/viewthroughconversion/${encodeURIComponent(conversionId)}/?${params.toString()}`;
}

function sendGoogleAdsRemarketing(payload, config) {
  try {
    const remarketingConfig = config?.googleAds?.remarketing;

    if (!remarketingConfig?.enabled) {
      return;
    }

    if (remarketingConfig.deliveryMode && remarketingConfig.deliveryMode !== "client") {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads remarketing skipped - not client mode", remarketingConfig.deliveryMode);
      return;
    }

    const eventName = normalizeRemarketingEventName(payload);
    const allowedEvents = Array.isArray(remarketingConfig.events)
      ? remarketingConfig.events
      : [];

    if (allowedEvents.length && allowedEvents.indexOf(eventName) === -1) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads remarketing skipped - event not selected", eventName);
      return;
    }

    if (!remarketingConfig.conversionId && !remarketingConfig.googleAdsCustomerId) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads remarketing skipped - missing conversion ID");
      return;
    }

    const url = buildGoogleAdsRemarketingUrl(payload, remarketingConfig);

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads remarketing sent", eventName, remarketingConfig.conversionId || remarketingConfig.googleAdsCustomerId);
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads remarketing error", e);
  }
}


function sendToGoogleAds(payload, config) {
  try {
    const googleAdsConfig = config?.googleAds;

    if (!googleAdsConfig?.enabled) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads skipped - not enabled", googleAdsConfig);
      return;
    }

    const eventName = mapGoogleAdsEventName(payload);
    const configured = googleAdsConfig.conversions?.[eventName];
    const conversions = Array.isArray(configured)
      ? configured
      : configured
        ? [configured]
        : [];

    const validConversions = conversions.filter(
      (conversion) => conversion?.conversionId && conversion?.conversionLabel
    );

    if (!validConversions.length) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads skipped - missing conversion", {
        eventName,
        available: Object.keys(googleAdsConfig.conversions || {}),
        missingLabels: googleAdsConfig.missingLabels || [],
      });
      return;
    }

    validConversions.forEach((conversion) => {
      const url = buildGoogleAdsUrl(payload, conversion);

      fetch(url, {
        method: "GET",
        mode: "no-cors",
        keepalive: true,
      });

      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] Google Ads sent",
        eventName,
        conversion.conversionName || "",
        conversion.conversionId,
        conversion.conversionLabel
      );
    });
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Google Ads send error", e);
  }
}


function buildGa4ClientSeedUrl(payload, measurementId) {
  var params = new URLSearchParams();

  params.set("v", "2");
  params.set("tid", measurementId);
  params.set("cid", payload.client_id || "dh_client");

  if (payload.session_id) {
    params.set("sid", String(payload.session_id));
  }

  params.set("en", "dh_ga4_debug_seed");
  params.set("_p", String(Date.now()));
  params.set("_dbg", "1");
  params.set("seg", "1");
  params.set("dl", payload.page_location || "");
  params.set("dt", payload.page_title || "");
  params.set("dr", payload.page_referrer || "");
  params.set("sr", "1920x1080");
  params.set("ul", "en-us");

  addParam(params, "ep.debug_mode", "true");
  addParam(params, "ep.engagement_time_msec", "1");
  addParam(params, "ep.event_id", String(payload.event_id || "seed") + "_ga4_seed");
  addParam(params, "ep.session_id", payload.session_id);
  addParam(params, "ep.source_event_name", payload.ga4_event || payload.original_event);

  return GA4_COLLECT_URL + "?" + params.toString();
}

function sendGa4ClientSeed(payload, config) {
  try {
    var measurementId =
      (config && config.ga4 && config.ga4.measurementId) ||
      (config && config.pixels && config.pixels.ga4Id) ||
      null;

    var shouldSeed =
      Boolean(measurementId) &&
      config &&
      config.ga4 &&
      config.ga4.deliveryMode === "server" &&
      config.ga4.testMode === true;

    if (!shouldSeed) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 client seed skipped", {
        pixelVersion: DH_PIXEL_VERSION,
        measurementId: measurementId,
        deliveryMode: config && config.ga4 ? config.ga4.deliveryMode : null,
        testMode: config && config.ga4 ? config.ga4.testMode : null,
      });
      return;
    }

    var url = buildGa4ClientSeedUrl(payload, measurementId);

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 client seed sent", measurementId, payload.client_id, payload.session_id);
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 client seed error", e);
  }
}

function sendToGa4(payload, config) {
  try {
    const measurementId =
      config?.ga4?.measurementId ||
      config?.pixels?.ga4Id ||
      null;

    const ga4Enabled =
      Boolean(measurementId) &&
      (!config?.ga4 || config.ga4.enabled !== false) &&
      (!config?.ga4 || config.ga4.deliveryMode !== "server");

    if (!ga4Enabled) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 skipped", {
        measurementId,
        deliveryMode: config?.ga4?.deliveryMode,
        enabled: config?.ga4?.enabled,
      });
      return;
    }

    const url = buildGa4Url(payload, measurementId);

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 sent", payload.ga4_event, measurementId);
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] GA4 send error", e);
  }
}

function getMetaConfig(config) {
  return config && config.meta ? config.meta : {};
}

function isMetaEventSelected(metaConfig, metaEventName) {
  var events = Array.isArray(metaConfig.selectedEvents)
    ? metaConfig.selectedEvents
    : [];

  return events.indexOf(metaEventName) !== -1;
}

function cleanShopifyGid(value) {
  value = firstValue(value);

  if (!value) return "";

  value = String(value);

  if (value.indexOf("gid://") === 0) {
    return value.split("/").pop();
  }

  return value;
}

function buildMetaContentId(item, itemIdFormat) {
  item = item || {};

  var rawProductId =
    item.product_id ||
    item.item_group_id ||
    item.productId ||
    item.id ||
    item.item_id ||
    "";

  var rawVariantId =
    item.variant_id ||
    item.variantId ||
    item.sku ||
    item.item_id ||
    "";

  var productId = cleanShopifyGid(rawProductId);
  var variantId = cleanShopifyGid(rawVariantId);

  if (itemIdFormat === "product_id") {
    return String(productId || item.item_id || "").trim();
  }

  if (itemIdFormat === "variant_id") {
    return String(variantId || item.item_id || "").trim();
  }

  if (itemIdFormat === "sku") {
    return String(item.sku || variantId || item.item_id || "").trim();
  }

  if (itemIdFormat === "product_variant") {
    if (productId && variantId) return productId + "_" + variantId;
    return String(item.item_id || productId || variantId || "").trim();
  }

  if (itemIdFormat === "shopify_country_product_variant") {
    var country = String(payloadCountryFallback(item) || "US").toUpperCase();

    if (productId && variantId) {
      return "shopify_" + country + "_" + productId + "_" + variantId;
    }

    return String(item.item_id || productId || variantId || "").trim();
  }

  return String(item.item_id || productId || variantId || "").trim();
}

function buildMetaContents(items, itemIdFormat) {
  if (!Array.isArray(items)) return [];

  return items
    .map(function (item) {
      var id = buildMetaContentId(item, itemIdFormat);

      if (!id) return null;

      return {
        id: id,
        quantity: Number(item.quantity || 1),
        item_price:
          item.price !== undefined && item.price !== null
            ? Number(item.price)
            : undefined,
      };
    })
    .filter(Boolean);
}

function buildMetaPixelUrl(payload, metaConfig) {
  var eventName = payload.meta_event;
  var meta = payload.meta || {};
  var params = new URLSearchParams();

  params.set("id", metaConfig.pixelId || metaConfig.datasetId);
  params.set("ev", eventName);
  params.set("dl", payload.page_location || "");
  params.set("rl", payload.page_referrer || "");
  params.set("if", "false");
  params.set("ts", String(Math.floor(Date.now() / 1000)));
  params.set("eid", payload.event_id);

  if (payload.attribution && payload.attribution.fbp) {
    params.set("fbp", payload.attribution.fbp);
  }

  if (payload.attribution && payload.attribution.fbc) {
    params.set("fbc", payload.attribution.fbc);
  }

  if (payload.value !== undefined && payload.value !== null) {
    params.set("cd[value]", String(payload.value));
  }

  if (payload.currency) {
    params.set("cd[currency]", String(payload.currency));
  }

  if (meta.content_type) {
    params.set("cd[content_type]", meta.content_type);
  }

  if (Array.isArray(meta.content_ids) && meta.content_ids.length) {
    params.set("cd[content_ids]", JSON.stringify(meta.content_ids));
  }

  if (Array.isArray(meta.contents) && meta.contents.length) {
    params.set("cd[contents]", JSON.stringify(meta.contents));
    params.set(
      "cd[num_items]",
      String(
        meta.contents.reduce(function (sum, item) {
          return sum + Number(item.quantity || 1);
        }, 0)
      )
    );
  }

  if (payload.transaction_id) {
    params.set("cd[order_id]", String(payload.transaction_id));
  }

  return META_PIXEL_URL + "?" + params.toString();
}

function getMetaSemanticDedupeKey(payload) {
  var eventName = payload.meta_event;

  if (
    eventName !== "InitiateCheckout" &&
    eventName !== "AddPaymentInfo" &&
    eventName !== "AddShippingInfo"
  ) {
    return "";
  }

  var raw = payload.raw || {};
  var ecommerce = payload.ecommerce || {};

  var checkoutKey =
    raw.checkout_token ||
    raw.checkout_id ||
    payload.transaction_id ||
    ecommerce.transaction_id ||
    payload.session_id ||
    payload.shopify_client_id ||
    payload.page_location ||
    "checkout";

  return [
    payload.shop || "shop",
    eventName,
    String(checkoutKey).split("?")[0].split("#")[0],
  ].join("|");
}

// Reserved for optional semantic deduplication.
// eslint-disable-next-line no-unused-vars
async function shouldSkipMetaSemanticEvent(payload, browser) {
  try {
    var key = getMetaSemanticDedupeKey(payload);

    if (!key) return false;

    var now = Date.now();
    var ttlMs = 2 * 60 * 60 * 1000;

    Object.keys(metaSemanticMemory).forEach(function (storedKey) {
      if (!metaSemanticMemory[storedKey] || now - Number(metaSemanticMemory[storedKey]) > ttlMs) {
        delete metaSemanticMemory[storedKey];
      }
    });

    // Immediate in-memory lock prevents two fast checkout events from both passing.
    if (metaSemanticMemory[key]) {
      return true;
    }

    metaSemanticMemory[key] = now;

    var raw = await readBrowserLocalStorage(browser, DH_META_SEMANTIC_DEDUP_KEY);
    var store = parseJson(raw);
    var changed = false;

    Object.keys(store).forEach(function (storedKey) {
      if (!store[storedKey] || now - Number(store[storedKey]) > ttlMs) {
        delete store[storedKey];
        changed = true;
      }
    });

    if (store[key]) {
      return true;
    }

    store[key] = now;
    changed = true;

    if (changed) {
      await writeBrowserLocalStorage(
        browser,
        DH_META_SEMANTIC_DEDUP_KEY,
        JSON.stringify(store)
      );
    }

    return false;
  } catch (e) {
    return false;
  }
}

function sendToMetaPixel(payload, config) {
  try {
    var metaConfig = getMetaConfig(config);
    var pixelId = metaConfig.pixelId || metaConfig.datasetId;

    if (payload.meta && payload.meta.skip === true) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Meta Pixel skipped", payload.meta.skip_reason);
      return;
    }

    if (!metaConfig.enabled || !metaConfig.clientSideEnabled || !pixelId) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Meta Pixel skipped - not enabled");
      return;
    }

    if (!isMetaEventSelected(metaConfig, payload.meta_event)) {
      DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Meta Pixel skipped - event not selected", payload.meta_event);
      return;
    }

    var url = buildMetaPixelUrl(payload, metaConfig);

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Meta Pixel sent", payload.meta_event, pixelId, payload.event_id);
  } catch (e) {
    DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] Meta Pixel send error", e);
  }
}

register(({ analytics, browser }) => {
  DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] loaded", DH_PIXEL_VERSION, "with GA4 client sender");

  [
    "page_viewed",
    "collection_viewed",
    "product_viewed",
    "product_added_to_cart",
    "product_removed_from_cart",
    "cart_viewed",
    "checkout_started",
    "checkout_contact_info_submitted",
    "checkout_shipping_info_submitted",
    "payment_info_submitted",
    "checkout_completed",
    "search_submitted",
  ].forEach((eventName) => {
    analytics.subscribe(eventName, async (event) => {
      try {
        const shop = getShop(event);
        const config = await getConfig(shop);
        const payload = await buildPayload(event, config, browser);

        DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel]", eventName, payload);
        DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] config snapshot", {
          pixelVersion: DH_PIXEL_VERSION,
          ga4: config && config.ga4 ? config.ga4 : null,
          testMode: config ? config.testMode : null,
        });

        const serverSendPromise = sendToServer(payload);

        sendToMetaPixel(payload, config);
        sendGa4ClientSeed(payload, config);
        sendToGa4(payload, config);
        sendToGoogleAds(payload, config);
        sendGoogleAdsRemarketing(payload, config);

        const serverSent = await serverSendPromise;

        if (!serverSent && isMetaCheckoutFallbackEvent(payload)) {
          DH_PIXEL_DEBUG && console.log(
            "[DH Tracking Pixel] primary checkout send failed; trying text fallback",
            payload.meta_event,
            payload.event_id
          );

          await sendToServerTextFallback(payload);
        }
      } catch (e) {
        DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel Error]", eventName, e);
      }
    });
  });
});
