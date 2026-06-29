import { register } from "@shopify/web-pixels-extension";

const CONFIG_URL = "https://tracking.datahatches.com/api/pixel-config";
const TRACK_URL = "https://tracking.datahatches.com/api/events/track";
const GA4_COLLECT_URL = "https://www.google-analytics.com/g/collect";
const GOOGLE_ADS_CONVERSION_URL = "https://www.googleadservices.com/pagead/conversion";

let cachedConfig = null;

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

function sendToServer(payload) {
  try {
    fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log("[DH Tracking Pixel] server send error", e);
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
      meta: "InitiateCheckout",
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
      price: cleanMoney(productVariant.price?.amount || cartLine.cost?.totalAmount?.amount),
      quantity: cleanMoney(cartLine.quantity) || 1,
    },
  ];
}

function buildPayload(event, config) {
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

  return {
    event_id: event.id,
    shop: getShop(event),
    original_event: event.name,
    ga4_event: mapped.ga4,
    meta_event: mapped.meta,
    client_id: event.clientId,
    timestamp: event.timestamp,
    page_location: event.context?.window?.location?.href,
    page_title: event.context?.document?.title,
    page_referrer: event.context?.document?.referrer,
    value,
    currency,
    transaction_id: checkout.order?.id || checkout.token || undefined,
    content_ids: itemId ? [String(itemId)] : undefined,
    item_name: product.title || productVariant.title || undefined,
    items: getItems(data),
    config,
    raw: data,
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
  params.set("en", payload.ga4_event || payload.original_event);
  params.set("_p", String(Date.now()));
  params.set("seg", "1");
  params.set("dl", payload.page_location || "");
  params.set("dt", payload.page_title || "");
  params.set("dr", payload.page_referrer || "");
  params.set("sr", "1920x1080");
  params.set("ul", "en-us");

  addParam(params, "ep.event_id", payload.event_id);
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

function sendToGoogleAds(payload, config) {
  try {
    const googleAdsConfig = config?.googleAds;

    if (!googleAdsConfig?.enabled) {
      console.log("[DH Tracking Pixel] Google Ads skipped - not enabled", googleAdsConfig);
      return;
    }

    const eventName = mapGoogleAdsEventName(payload);
    const conversion = googleAdsConfig.conversions?.[eventName];

    if (!conversion?.conversionId || !conversion?.conversionLabel) {
      console.log("[DH Tracking Pixel] Google Ads skipped - missing conversion", {
        eventName,
        available: Object.keys(googleAdsConfig.conversions || {}),
        missingLabels: googleAdsConfig.missingLabels || [],
      });
      return;
    }

    const url = buildGoogleAdsUrl(payload, conversion);

    fetch(url, {
      method: "GET",
      mode: "no-cors",
      keepalive: true,
    });

    console.log("[DH Tracking Pixel] Google Ads sent", eventName, conversion.conversionId, conversion.conversionLabel);
  } catch (e) {
    console.log("[DH Tracking Pixel] Google Ads send error", e);
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
      console.log("[DH Tracking Pixel] GA4 skipped", {
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

    console.log("[DH Tracking Pixel] GA4 sent", payload.ga4_event, measurementId);
  } catch (e) {
    console.log("[DH Tracking Pixel] GA4 send error", e);
  }
}

register(({ analytics }) => {
  console.log("[DH Tracking Pixel] loaded with GA4 client sender");

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
        const payload = buildPayload(event, config);

        console.log("[DH Tracking Pixel]", eventName, payload);

        sendToServer(payload);
        sendToGa4(payload, config);
        sendToGoogleAds(payload, config);
      } catch (e) {
        console.log("[DH Tracking Pixel Error]", eventName, e);
      }
    });
  });
});
