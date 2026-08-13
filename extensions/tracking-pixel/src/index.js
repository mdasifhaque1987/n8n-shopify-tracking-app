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
const DH_ITEM_METADATA_STORAGE_KEY = "dh_item_metadata_v1";
const DH_ITEM_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DH_ITEM_METADATA_MAX_ENTRIES = 200;
const DH_PURCHASE_EVENT_ID_STORAGE_PREFIX =
  "dh_purchase_event_id_v1:";
const DH_PIXEL_VERSION =
  "2026-08-10-meta-browser-cors-v9";
const DH_PIXEL_DEBUG = false;

let cachedConfig = null;
let metaSemanticMemory = {};
let dhBrowserId = null;
let dhPageLoadId = null;
let dhEventSequence = 0;
let dhFallbackPurchaseEventId = null;

async function getConfig(shop) {
  if (cachedConfig) return cachedConfig;

  const res = await fetch(`${CONFIG_URL}?shop=${encodeURIComponent(shop || "")}`, {
    method: "GET",
    keepalive: true,
  });

  cachedConfig = await res.json();
  return cachedConfig;
}

function parseSettingJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function configFromPixelSettings(settings) {
  if (!settings) return null;
  const clientEvents = parseSettingJson(settings.client_event_settings, {});
  const testMode = parseSettingJson(settings.test_mode_settings, { enabled: false, channels: {} });
  const ga4Test = testMode.channels && testMode.channels.ga4_client;
  return {
    testMode: Boolean(testMode.enabled),
    ga4: {
      enabled: settings.ga4_enabled === "true",
      clientSideEnabled: settings.ga4_enabled === "true",
      deliveryMode: "client",
      measurementId: settings.ga4_measurement_id || null,
      selectedEvents: Array.isArray(clientEvents.ga4Events)
        ? clientEvents.ga4Events
        : [],
      testMode: Boolean(ga4Test && ga4Test.enabled),
    },
    meta: {
      enabled: settings.meta_enabled === "true",
      clientSideEnabled: settings.meta_enabled === "true",
      pixelId: settings.meta_pixel_id || null,
      datasetId: settings.meta_pixel_id || null,
      selectedEvents: Array.isArray(clientEvents.metaEvents) ? clientEvents.metaEvents : [],
      testMode: Boolean(testMode.channels && testMode.channels.meta_pixel && testMode.channels.meta_pixel.enabled),
    },
    googleAds: {
      enabled: Array.isArray(clientEvents.googleAdsConversions) && clientEvents.googleAdsConversions.length > 0,
      conversions: (clientEvents.googleAdsConversions || []).reduce(function (result, conversion) {
        var key = conversion.eventName;
        if (!result[key]) result[key] = [];
        result[key].push(conversion);
        return result;
      }, {}),
    },
  };
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

function generateDhEventIdPart() {
  return (
    Date.now() +
    Math.floor(
      100000 +
      Math.random() * 900000
    )
  );
}

function getDhBrowserId() {
  if (!dhBrowserId) {
    dhBrowserId =
      generateDhEventIdPart();
  }

  return dhBrowserId;
}

function getDhPageLoadId() {
  if (!dhPageLoadId) {
    dhPageLoadId =
      generateDhEventIdPart();
  }

  return dhPageLoadId;
}

function createDhUniqueEventId() {
  dhEventSequence += 1;

  return (
    "dh_" +
    getDhBrowserId() +
    "_" +
    getDhPageLoadId() +
    String(dhEventSequence)
  );
}

function isDhUniqueEventId(value) {
  return (
    typeof value === "string" &&
    /^dh_\d+_\d+$/.test(value)
  );
}

function getCheckoutToken(checkout) {
  checkout = checkout || {};

  var value =
    checkout.token ||
    checkout.checkoutToken ||
    checkout.id;

  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function isCheckoutJourneyEvent(
  eventName
) {
  return [
    "begin_checkout",
    "add_contact_info",
    "add_shipping_info",
    "add_payment_info",
    "purchase",
  ].indexOf(eventName) !== -1;
}

async function getOrCreatePurchaseEventId(
  browser,
  checkout
) {
  var checkoutToken =
    getCheckoutToken(checkout);

  if (checkoutToken) {
    var storageKey =
      DH_PURCHASE_EVENT_ID_STORAGE_PREFIX +
      encodeURIComponent(
        checkoutToken
      );

    var stored =
      await storageGet(
        browser,
        storageKey
      );

    if (
      isDhUniqueEventId(stored)
    ) {
      return stored;
    }

    var generated =
      createDhUniqueEventId();

    await storageSet(
      browser,
      storageKey,
      generated
    );

    return generated;
  }

  if (
    !isDhUniqueEventId(
      dhFallbackPurchaseEventId
    )
  ) {
    dhFallbackPurchaseEventId =
      createDhUniqueEventId();
  }

  return dhFallbackPurchaseEventId;
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

async function sendToServer(payload, ingestKey, ingestionEndpoint) {
  try {
    if (!ingestKey) return false;

    const body = JSON.stringify(payload);
    const appProxyUrls = getAppProxyTrackUrls(payload);

    // Send direct server endpoint first for checkout step reliability.
    // App proxy is kept only as fallback.
    const endpoints = [ingestionEndpoint || TRACK_URL].concat(appProxyUrls).filter(Boolean);
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + ingestKey,
          },
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
      meta: "ViewContentList",
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
    checkout_address_info_submitted: {
      ga4: "add_shipping_info",
      meta: "AddShippingInfo",
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

function firstItemMoney() {
  for (let index = 0; index < arguments.length; index += 1) {
    const parsed = cleanMoney(arguments[index]);

    if (
      typeof parsed === "number" &&
      Number.isFinite(parsed)
    ) {
      return parsed;
    }
  }

  return null;
}

function roundItemMoney(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(Math.max(0, parsed).toFixed(6));
}

function positiveItemQuantity(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return parsed;
}

function cleanItemIdentifier(value) {
  const normalized = String(
    safeString(value) || ""
  ).trim();

  if (normalized.indexOf("gid://") === 0) {
    return normalized.split("/").pop() || "";
  }

  return normalized;
}

function getItemCategory(product) {
  product = product || {};

  if (product.productType) {
    return String(product.productType);
  }

  if (product.type) {
    return String(product.type);
  }

  if (typeof product.category === "string") {
    return product.category;
  }

  if (
    product.category &&
    typeof product.category === "object"
  ) {
    return String(
      product.category.fullName ||
      product.category.name ||
      ""
    );
  }

  return "";
}

function getLineDiscountTotal(line) {
  line = line || {};

  const directDiscount = firstItemMoney(
    line.totalDiscount?.amount,
    line.total_discount,
    line.totalDiscount
  );

  if (directDiscount !== null) {
    return roundItemMoney(directDiscount);
  }

  const allocations =
    line.discountAllocations ||
    line.discount_allocations ||
    [];

  if (!Array.isArray(allocations)) {
    return 0;
  }

  return roundItemMoney(
    allocations.reduce(function (sum, allocation) {
      const amount = firstItemMoney(
        allocation?.discountedAmount?.amount,
        allocation?.amount?.amount,
        allocation?.amount
      );

      return sum + (amount || 0);
    }, 0)
  );
}

function buildNormalizedItem(input) {
  const itemId = cleanItemIdentifier(
    input.itemId
  );

  return {
    id: itemId,
    item_id: itemId,
    item_name: String(
      input.itemName || ""
    ),
    item_brand: String(
      input.itemBrand || ""
    ),
    product_id: cleanItemIdentifier(
      input.productId
    ),
    variant_id: cleanItemIdentifier(
      input.variantId
    ),
    item_variant: String(
      input.itemVariant || ""
    ),
    price: roundItemMoney(
      input.price
    ),
    discount: roundItemMoney(
      input.discount
    ),
    item_category: String(
      input.itemCategory || ""
    ),
    quantity: positiveItemQuantity(
      input.quantity
    ),
    sku: String(
      safeString(input.sku) || ""
    ),
    currency:
      input.currency
        ? String(input.currency)
        : undefined,
  };
}

function parseItemMetadataCache(raw) {
  try {
    const parsed = raw
      ? JSON.parse(raw)
      : {};

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch {
    return {};
  }

  return {};
}

function getItemMetadataKeys(item) {
  item = item || {};

  const values = [
    item.variant_id,
    item.item_id,
    item.id,
    item.sku,
  ];

  const keys = [];

  values.forEach(function (value) {
    const normalized =
      cleanItemIdentifier(value);

    if (
      normalized &&
      keys.indexOf(normalized) === -1
    ) {
      keys.push(normalized);
    }
  });

  return keys;
}

function getMeaningfulItemVariant(value, item) {
  const normalized =
    String(value || "").trim();

  if (!normalized) {
    return "";
  }

  const identifiers = [
    item?.variant_id,
    item?.item_id,
    item?.id,
  ]
    .map(function (identifier) {
      return cleanItemIdentifier(
        identifier
      );
    })
    .filter(Boolean);

  if (
    identifiers.indexOf(
      cleanItemIdentifier(normalized)
    ) !== -1
  ) {
    return "";
  }

  return normalized;
}

function mergeItemMetadata(item, cached) {
  item = item || {};
  cached = cached || {};

  const currentVariant =
    getMeaningfulItemVariant(
      item.item_variant,
      item
    );

  const cachedVariant =
    getMeaningfulItemVariant(
      cached.item_variant,
      item
    );

  const sku =
    String(
      item.sku ||
      cached.sku ||
      ""
    ).trim();

  return {
    ...item,
    item_name:
      item.item_name ||
      cached.item_name ||
      "",
    item_brand:
      item.item_brand ||
      cached.item_brand ||
      "",
    product_id:
      item.product_id ||
      cached.product_id ||
      "",
    variant_id:
      item.variant_id ||
      cached.variant_id ||
      "",
    item_variant:
      currentVariant ||
      cachedVariant ||
      sku ||
      "",
    item_category:
      item.item_category ||
      cached.item_category ||
      "",
    sku,
  };
}

async function enrichItemsWithStoredMetadata(
  items,
  browser
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return [];
  }

  const raw = await storageGet(
    browser,
    DH_ITEM_METADATA_STORAGE_KEY
  );

  const cache =
    parseItemMetadataCache(raw);

  const now = Date.now();

  return items.map(function (item) {
    const keys =
      getItemMetadataKeys(item);

    let cached = null;

    for (
      let index = 0;
      index < keys.length;
      index += 1
    ) {
      const candidate =
        cache[keys[index]];

      if (
        candidate &&
        typeof candidate === "object" &&
        now -
          Number(
            candidate.updated_at || 0
          ) <=
          DH_ITEM_METADATA_TTL_MS
      ) {
        cached = candidate;
        break;
      }
    }

    return mergeItemMetadata(
      item,
      cached
    );
  });
}

async function persistItemMetadata(
  items,
  browser
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return;
  }

  const raw = await storageGet(
    browser,
    DH_ITEM_METADATA_STORAGE_KEY
  );

  const current =
    parseItemMetadataCache(raw);

  const now = Date.now();
  const cache = {};

  Object.keys(current).forEach(
    function (key) {
      const candidate =
        current[key];

      if (
        candidate &&
        typeof candidate === "object" &&
        now -
          Number(
            candidate.updated_at || 0
          ) <=
          DH_ITEM_METADATA_TTL_MS
      ) {
        cache[key] = candidate;
      }
    }
  );

  items.forEach(function (item) {
    const variant =
      getMeaningfulItemVariant(
        item.item_variant,
        item
      );

    const metadata = {
      item_name:
        String(
          item.item_name || ""
        ),
      item_brand:
        String(
          item.item_brand || ""
        ),
      product_id:
        cleanItemIdentifier(
          item.product_id
        ),
      variant_id:
        cleanItemIdentifier(
          item.variant_id
        ),
      item_variant:
        variant ||
        String(item.sku || ""),
      item_category:
        String(
          item.item_category || ""
        ),
      sku:
        String(item.sku || ""),
      updated_at: now,
    };

    getItemMetadataKeys(item).forEach(
      function (key) {
        cache[key] = metadata;
      }
    );
  });

  const newestKeys =
    Object.keys(cache)
      .sort(function (left, right) {
        return (
          Number(
            cache[right]?.updated_at ||
            0
          ) -
          Number(
            cache[left]?.updated_at ||
            0
          )
        );
      })
      .slice(
        0,
        DH_ITEM_METADATA_MAX_ENTRIES
      );

  const limitedCache = {};

  newestKeys.forEach(function (key) {
    limitedCache[key] = cache[key];
  });

  await storageSet(
    browser,
    DH_ITEM_METADATA_STORAGE_KEY,
    JSON.stringify(limitedCache)
  );
}

function getItems(data) {
  const checkout = data.checkout || {};
  const cartLine = data.cartLine || {};
  const productVariant =
    data.productVariant ||
    cartLine.merchandise ||
    {};
  const product =
    productVariant.product || {};
  const collection = data.collection || {};

  if (
    Array.isArray(
      collection.productVariants
    )
  ) {
    return collection.productVariants.map(
      function (variant) {
        const variantProduct =
          variant.product || {};

        const price =
          firstItemMoney(
            variant.price?.amount
          ) || 0;

        const originalPrice =
          firstItemMoney(
            variant.compareAtPrice?.amount,
            variant.compare_at_price?.amount
          );

        const discount =
          originalPrice !== null &&
          originalPrice > price
            ? originalPrice - price
            : 0;

        return buildNormalizedItem({
          itemId:
            variant.id ||
            variantProduct.id,
          itemName:
            variantProduct.title ||
            variant.title,
          itemBrand:
            variantProduct.vendor ||
            variantProduct.brand,
          productId:
            variantProduct.id,
          variantId:
            variant.id,
          itemVariant:
            variant.title ||
            variant.sku ||
            "",
          price,
          discount,
          itemCategory:
            getItemCategory(
              variantProduct
            ),
          quantity: 1,
          sku: variant.sku,
          currency:
            variant.price?.currencyCode,
        });
      }
    );
  }

  if (
    Array.isArray(checkout.lineItems)
  ) {
    return checkout.lineItems.map(
      function (line) {
        const variant =
          line.variant ||
          line.merchandise ||
          {};

        const lineProduct =
          variant.product || {};

        const quantity =
          positiveItemQuantity(
            line.quantity
          );

        const finalLineTotal =
          firstItemMoney(
            line.finalLinePrice?.amount,
            line.cost?.totalAmount?.amount,
            line.discountedTotal?.amount
          );

        const originalLineTotal =
          firstItemMoney(
            line.originalLinePrice?.amount,
            line.cost?.subtotalAmount?.amount
          );

        const originalUnitPrice =
          firstItemMoney(
            variant.price?.amount,
            line.price?.amount,
            line.price
          );

        const discountTotal =
          getLineDiscountTotal(line);

        const unitPrice =
          finalLineTotal !== null
            ? finalLineTotal / quantity
            : originalUnitPrice || 0;

        let unitDiscount =
          discountTotal > 0
            ? discountTotal / quantity
            : 0;

        if (
          unitDiscount === 0 &&
          originalLineTotal !== null &&
          finalLineTotal !== null &&
          originalLineTotal >
            finalLineTotal
        ) {
          unitDiscount =
            (
              originalLineTotal -
              finalLineTotal
            ) / quantity;
        }

        if (
          unitDiscount === 0 &&
          originalUnitPrice !== null &&
          originalUnitPrice > unitPrice
        ) {
          unitDiscount =
            originalUnitPrice -
            unitPrice;
        }

        return buildNormalizedItem({
          itemId:
            variant.id ||
            lineProduct.id ||
            line.id,
          itemName:
            lineProduct.title ||
            variant.title ||
            line.title,
          itemBrand:
            lineProduct.vendor ||
            lineProduct.brand ||
            line.vendor,
          productId:
            lineProduct.id ||
            line.productId ||
            line.product_id,
          variantId:
            variant.id ||
            line.variantId ||
            line.variant_id,
          itemVariant:
            variant.title ||
            line.variantTitle ||
            line.variant_title ||
            variant.sku ||
            line.sku ||
            "",
          price: unitPrice,
          discount: unitDiscount,
          itemCategory:
            getItemCategory(
              lineProduct
            ) ||
            line.productType ||
            line.product_type,
          quantity,
          sku:
            variant.sku ||
            line.sku,
          currency:
            line.finalLinePrice
              ?.currencyCode ||
            line.cost?.totalAmount
              ?.currencyCode ||
            checkout.currencyCode,
        });
      }
    );
  }

  const itemId =
    productVariant.id ||
    product.id ||
    cartLine.merchandise?.id;

  const itemName =
    product.title ||
    productVariant.title ||
    cartLine.merchandise?.title;

  if (!itemId && !itemName) {
    return [];
  }

  const quantity =
    positiveItemQuantity(
      cartLine.quantity
    );

  const cartTotal =
    firstItemMoney(
      cartLine.cost?.totalAmount?.amount
    );

  const perQuantityPrice =
    firstItemMoney(
      cartLine.cost
        ?.amountPerQuantity?.amount
    );

  const variantPrice =
    firstItemMoney(
      productVariant.price?.amount,
      cartLine.merchandise
        ?.price?.amount
    );

  const price =
    perQuantityPrice !== null
      ? perQuantityPrice
      : cartTotal !== null
        ? cartTotal / quantity
        : variantPrice || 0;

  const originalPrice =
    firstItemMoney(
      productVariant
        .compareAtPrice?.amount,
      productVariant
        .compare_at_price?.amount,
      cartLine.merchandise
        ?.compareAtPrice?.amount
    );

  const discount =
    originalPrice !== null &&
    originalPrice > price
      ? originalPrice - price
      : 0;

  return [
    buildNormalizedItem({
      itemId,
      itemName,
      itemBrand:
        product.vendor ||
        product.brand,
      productId:
        product.id,
      variantId:
        productVariant.id ||
        cartLine.merchandise?.id,
      itemVariant:
        productVariant.title ||
        cartLine.merchandise?.title ||
        productVariant.sku ||
        cartLine.merchandise?.sku ||
        "",
      price,
      discount,
      itemCategory:
        getItemCategory(product),
      quantity,
      sku:
        productVariant.sku ||
        cartLine.merchandise?.sku,
      currency:
        productVariant.price
          ?.currencyCode ||
        cartLine.cost?.totalAmount
          ?.currencyCode,
    }),
  ];
}

async function buildPayload(event, config, browser) {
  const mapped = mapEvent(event.name);
  const data = event.data || {};
  const checkout = data.checkout || {};
  const cartLine = data.cartLine || {};
  const productVariant = data.productVariant || cartLine.merchandise || {};
  const product = productVariant.product || {};

  const collection = data.collection || {};
  const collectionVariants =
    Array.isArray(
      collection.productVariants
    )
      ? collection.productVariants
      : [];

  let items = getItems(data);

  items =
    await enrichItemsWithStoredMetadata(
      items,
      browser
    );

  await persistItemMetadata(
    items,
    browser
  );

  const collectionValue =
    collectionVariants.length
      ? Number(
          collectionVariants
            .reduce(
              (sum, variant) =>
                sum +
                (
                  cleanMoney(
                    variant?.price?.amount
                  ) || 0
                ),
              0
            )
            .toFixed(6)
        )
      : undefined;

  const value =
    cleanMoney(
      checkout.totalPrice?.amount
    ) ||
    cleanMoney(
      cartLine.cost?.totalAmount?.amount
    ) ||
    cleanMoney(
      productVariant.price?.amount
    ) ||
    collectionValue;

  const currency =
    checkout.currencyCode ||
    checkout.totalPrice?.currencyCode ||
    cartLine.cost?.totalAmount
      ?.currencyCode ||
    productVariant.price
      ?.currencyCode ||
    collectionVariants[0]
      ?.price?.currencyCode;

  const itemId =
    productVariant.id ||
    product.id ||
    cartLine.merchandise?.id ||
    collectionVariants[0]?.id ||
    undefined;

  const transactionId =
    mapped.ga4 === "purchase" ||
    mapped.ga4 === "refund"
      ? cleanItemIdentifier(
          checkout.order?.id ||
          checkout.orderId
        ) || undefined
      : undefined;
  const attribution = await getAttribution(event, browser);
  const customer = await getCustomerForEvent(data, browser);
  const ecommerce = getEcommerce(data, value, currency, transactionId, items);
  const metaContentIdFormat =
    config?.meta?.contentIdFormat || "shopify_country_product_variant";
  const metaContents = buildMetaContents(items, metaContentIdFormat);
  const metaContentIds = metaContents.map((item) => item.id).filter(Boolean);
  const gaIdentity = await getGaIdentity(browser, event);

  const purchaseEventId =
    isCheckoutJourneyEvent(
      mapped.ga4
    )
      ? await getOrCreatePurchaseEventId(
          browser,
          checkout
        )
      : undefined;

  const normalizedEventId =
    mapped.ga4 === "purchase"
      ? purchaseEventId ||
        createDhUniqueEventId()
      : createDhUniqueEventId();

  return {
    event_id: normalizedEventId,
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
      shopify_event_id: event.id || undefined,
      purchase_event_id:
        purchaseEventId,
      checkout_token:
        getCheckoutToken(checkout) ||
        undefined,
      checkout_id:
        checkout.id || undefined,
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

  if (payload.ga4_debug_mode === true) {
    addParam(params, "ep.debug_mode", "true");
    addParam(params, "_dbg", "1");
  }

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
      addParam(params, `pr${n}id`, item.item_id || item.id);
      addParam(params, `pr${n}nm`, item.item_name);
      addParam(params, `pr${n}br`, item.item_brand);
      addParam(params, `pr${n}ca`, item.item_category);
      addParam(params, `pr${n}va`, item.item_variant);
      addParam(params, `pr${n}pr`, item.price);
      addParam(params, `pr${n}qt`, item.quantity);
      addParam(params, `pr${n}ds`, item.discount);
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
    remove_from_cart: "REMOVE_FROM_CART",
    view_cart: "VIEW_CART",
    begin_checkout: "BEGIN_CHECKOUT",
    add_contact_info: "ADD_CONTACT_INFO",
    add_shipping_info: "ADD_SHIPPING_INFO",
    add_payment_info: "ADD_PAYMENT_INFO",
    purchase: "PURCHASE",
    search: "SEARCH",
    generate_lead: "LEAD",
    sign_up: "SUBSCRIBE",
  };

  const ga4Event = String(
    payload.ga4_event || ""
  ).trim();

  const originalEvent = String(
    payload.original_event || ""
  ).trim();

  return (
    map[ga4Event] ||
    map[originalEvent] ||
    ga4Event.toUpperCase()
  );
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

function getRemarketingItems(payload) {
  if (
    Array.isArray(payload.items) &&
    payload.items.length
  ) {
    return payload.items;
  }

  return [];
}

function buildRemarketingProductId(item, itemIdFormat) {
  const rawProductId =
    item.product_id ||
    item.item_group_id ||
    item.id ||
    item.item_id ||
    "";

  const rawVariantId =
    item.variant_id ||
    item.variantId ||
    item.sku ||
    "";

  const productId =
    cleanShopifyGid(rawProductId);

  const variantId =
    cleanShopifyGid(rawVariantId);

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

  const eventName =
    normalizeRemarketingEventName(
      payload
    );

  const itemIdFormat =
    remarketingConfig.itemIdFormat ||
    "shopify_country_product_variant";

  const remarketingItems =
    getRemarketingItems(payload);

  const productIds =
    remarketingItems
      .map((item) =>
        buildRemarketingProductId(
          item,
          itemIdFormat
        )
      )
      .filter(Boolean);

  const productIdValue =
    productIds.length > 1
      ? JSON.stringify(productIds)
      : productIds[0] || "";

  const pageType =
    getRemarketingPageType(
      eventName
    );

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

  if (productIdValue) {
    customParams.push(
      `ecomm_prodid=${encodeURIComponent(
        productIdValue
      )}`
    );
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

    if (allowedEvents.indexOf(eventName) === -1) {
      DH_PIXEL_DEBUG &&
        console.log(
          "[DH Tracking Pixel] Google Ads remarketing skipped - event not selected",
          eventName,
          allowedEvents
        );
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
  const deliveries = [];

  try {
    const googleAdsConfig = config?.googleAds;

    if (!googleAdsConfig?.enabled) {
      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] Google Ads skipped - not enabled",
        googleAdsConfig
      );

      return deliveries;
    }

    const eventName = mapGoogleAdsEventName(payload);
    const configured =
      googleAdsConfig.conversions?.[eventName];

    const conversions = Array.isArray(configured)
      ? configured
      : configured
        ? [configured]
        : [];

    const validConversions = conversions.filter(
      (conversion) =>
        conversion?.conversionId &&
        conversion?.conversionLabel
    );

    if (!validConversions.length) {
      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] Google Ads skipped - missing conversion",
        {
          eventName,
          available: Object.keys(
            googleAdsConfig.conversions || {}
          ),
          missingLabels:
            googleAdsConfig.missingLabels || [],
        }
      );

      return deliveries;
    }

    validConversions.forEach((conversion) => {
      const url = buildGoogleAdsUrl(
        payload,
        conversion
      );

      fetch(url, {
        method: "GET",
        mode: "no-cors",
        keepalive: true,
      });

      deliveries.push({
        platform: "google_ads",
        status: "sent",
        message:
          "Google Ads client conversion request dispatched.",
        eventName,
        conversionName:
          conversion.conversionName || "",
        conversionActionId:
          conversion.conversionActionId || "",
        conversionId:
          conversion.conversionId || "",
        conversionLabel:
          conversion.conversionLabel || "",
      });

      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] Google Ads sent",
        eventName,
        conversion.conversionName || "",
        conversion.conversionId,
        conversion.conversionLabel
      );
    });

    return deliveries;
  } catch (e) {
    DH_PIXEL_DEBUG && console.log(
      "[DH Tracking Pixel] Google Ads send error",
      e
    );

    return [
      {
        platform: "google_ads",
        status: "failed",
        message:
          "Google Ads client conversion dispatch failed.",
        eventName: mapGoogleAdsEventName(payload),
        error:
          e instanceof Error
            ? e.message
            : String(e),
      },
    ];
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
      (!config?.ga4 ||
        config.ga4.enabled !== false) &&
      (!config?.ga4 ||
        config.ga4.deliveryMode !== "server");

    if (!ga4Enabled) {
      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] GA4 skipped",
        {
          measurementId,
          deliveryMode:
            config?.ga4?.deliveryMode,
          enabled: config?.ga4?.enabled,
        }
      );

      return null;
    }

    const selectedEvents =
      Array.isArray(config?.ga4?.selectedEvents)
        ? config.ga4.selectedEvents
        : [];

    const ga4EventName = String(
      payload.ga4_event ||
      payload.original_event ||
      ""
    ).trim();

    if (!selectedEvents.includes(ga4EventName)) {
      DH_PIXEL_DEBUG && console.log(
        "[DH Tracking Pixel] GA4 skipped - event not selected",
        {
          eventName: ga4EventName,
          selectedEvents,
        }
      );

      return null;
    }

    const url = buildGa4Url(
      { ...payload, ga4_debug_mode: config?.ga4?.testMode === true },
      measurementId
    );

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    DH_PIXEL_DEBUG && console.log(
      "[DH Tracking Pixel] GA4 sent",
      payload.ga4_event,
      measurementId
    );

    return {
      platform: "ga4",
      status: "sent",
      message: "GA4 client request dispatched.",
      eventName:
        payload.ga4_event ||
        payload.original_event ||
        "",
      measurementId,
    };
  } catch (e) {
    DH_PIXEL_DEBUG && console.log(
      "[DH Tracking Pixel] GA4 send error",
      e
    );

    return {
      platform: "ga4",
      status: "failed",
      message: "GA4 client dispatch failed.",
      eventName:
        payload.ga4_event ||
        payload.original_event ||
        "",
      error:
        e instanceof Error
          ? e.message
          : String(e),
    };
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
  params.set("noscript", "1");

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

async function sendToMetaPixel(payload, config) {
  var metaConfig = getMetaConfig(config);
  var pixelId =
    metaConfig.pixelId ||
    metaConfig.datasetId;

  try {
    if (
      payload.meta &&
      payload.meta.skip === true
    ) {
      DH_PIXEL_DEBUG &&
        console.log(
          "[DH Tracking Pixel] Meta Pixel skipped",
          payload.meta.skip_reason
        );

      return false;
    }

    if (
      !metaConfig.enabled ||
      !metaConfig.clientSideEnabled ||
      !pixelId
    ) {
      DH_PIXEL_DEBUG &&
        console.log(
          "[DH Tracking Pixel] Meta Pixel skipped - not enabled"
        );

      return false;
    }

    if (
      !isMetaEventSelected(
        metaConfig,
        payload.meta_event
      )
    ) {
      DH_PIXEL_DEBUG &&
        console.log(
          "[DH Tracking Pixel] Meta Pixel skipped - event not selected",
          payload.meta_event
        );

      return false;
    }

    var url =
      buildMetaPixelUrl(
        payload,
        metaConfig
      );

    var response =
      await fetch(
        url,
        {
          method: "GET",
          mode: "cors",
          credentials: "include",
          keepalive: true,
        }
      );

    if (!response.ok) {
      throw new Error(
        "Meta Pixel HTTP " +
        response.status
      );
    }

    DH_PIXEL_DEBUG &&
      console.log(
        "[DH Tracking Pixel] Meta Pixel browser request accepted",
        payload.meta_event,
        pixelId,
        payload.event_id,
        response.status
      );

    return true;
  } catch (e) {
    DH_PIXEL_DEBUG &&
      console.log(
        "[DH Tracking Pixel] Meta Pixel browser request failed",
        payload.meta_event,
        pixelId,
        payload.event_id,
        e
      );

    return false;
  }
}

register(({ analytics, browser, settings }) => {
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
    "checkout_address_info_submitted",
    "checkout_shipping_info_submitted",
    "payment_info_submitted",
    "checkout_completed",
    "search_submitted",
  ].forEach((eventName) => {
    analytics.subscribe(eventName, async (event) => {
      try {
        const shop =
          (settings && settings.shop_domain) ||
          getShop(event);
        // Shopify pixel settings are the authoritative, checkout-safe client
        // configuration. The endpoint remains only as a legacy fallback for
        // installations that have not yet refreshed their pixel.
        const config = configFromPixelSettings(settings) || await getConfig(shop);
        const payload = {
          ...(await buildPayload(event, config, browser)),
          shop,
        };

        DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel] config snapshot", {
          pixelVersion: DH_PIXEL_VERSION,
          ga4: config && config.ga4 ? config.ga4 : null,
          testMode: config ? config.testMode : null,
        });

        const clientDeliveries = [];

        const metaPixelDelivery =
          sendToMetaPixel(
            payload,
            config
          );

        const ga4ClientDelivery =
          sendToGa4(payload, config);

        if (ga4ClientDelivery) {
          clientDeliveries.push(
            ga4ClientDelivery
          );
        }

        const googleAdsClientDeliveries =
          sendToGoogleAds(payload, config);

        if (
          Array.isArray(
            googleAdsClientDeliveries
          )
        ) {
          clientDeliveries.push(
            ...googleAdsClientDeliveries
          );
        }

        sendGoogleAdsRemarketing(
          payload,
          config
        );

        const serverPayload = {
          ...payload,
          client_deliveries:
            clientDeliveries,
        };

        await Promise.all([
          sendToServer(
            serverPayload,
            settings && settings.ingest_key,
            settings && settings.ingestion_endpoint
          ),
          metaPixelDelivery,
        ]);
      } catch (e) {
        DH_PIXEL_DEBUG && console.log("[DH Tracking Pixel Error]", eventName, e);
      }
    });
  });
});
