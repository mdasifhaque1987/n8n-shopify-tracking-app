import db from "../db.server";
import type { NormalizedTrackingEvent } from "./normalize-event.server";

type CustomerPayload = Record<string, unknown>;

function stringValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function cleanShop(shop: string) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function getAdminApiVersion() {
  return process.env.SHOPIFY_ADMIN_API_VERSION || "2025-10";
}

function getTransactionId(event: NormalizedTrackingEvent) {
  const ecommerce = event.ecommerce || {};

  return (
    stringValue(ecommerce.transaction_id) ||
    stringValue(ecommerce.order_id) ||
    stringValue(event.transaction_id)
  );
}

function hasCustomerIdentity(customer?: CustomerPayload | null) {
  if (!customer) return false;

  return Boolean(
    firstValue(
      customer.email,
      customer.phone,
      customer.first_name,
      customer.last_name,
      customer.customer_id
    )
  );
}

function mergeAddress(
  currentAddress?: Record<string, unknown> | null,
  orderAddress?: Record<string, unknown> | null
) {
  const current = currentAddress || {};
  const order = orderAddress || {};

  return {
    address1: firstValue(
      current.address1,
      order.address1,
      order.address_line_1,
      order.line1,
      order.street
    ),
    address2: firstValue(
      current.address2,
      order.address2,
      order.address_line_2,
      order.line2,
      order.company
    ),
    city: firstValue(current.city, order.city),
    state: firstValue(
      current.state,
      order.province_code,
      order.provinceCode,
      order.province,
      order.state
    ),
    zip: firstValue(
      current.zip,
      order.zip,
      order.postal_code,
      order.postalCode
    ),
    country: firstValue(
      current.country,
      order.country_code,
      order.countryCodeV2,
      order.country,
      order.countryCode
    ),
  };
}

function mergeCustomer(
  currentCustomer?: CustomerPayload | null,
  orderCustomer?: CustomerPayload | null
) {
  const current = currentCustomer || {};
  const order = orderCustomer || {};

  return {
    email: firstValue(current.email, order.email),
    phone: firstValue(current.phone, order.phone),
    first_name: firstValue(current.first_name, order.first_name),
    last_name: firstValue(current.last_name, order.last_name),
    customer_id: firstValue(current.customer_id, order.customer_id),
    address: mergeAddress(
      current.address as Record<string, unknown> | undefined,
      order.address as Record<string, unknown> | undefined
    ),
  };
}

async function getShopifyAccessToken(shop: string) {
  const clean = cleanShop(shop);

  const offlineSession = await db.session.findUnique({
    where: {
      id: `offline_${clean}`,
    },
    select: {
      accessToken: true,
    },
  });

  if (offlineSession?.accessToken) {
    return offlineSession.accessToken;
  }

  const session = await db.session.findFirst({
    where: {
      shop: clean,
    },
    orderBy: {
      id: "asc",
    },
    select: {
      accessToken: true,
    },
  });

  return session?.accessToken || "";
}

const SHOPIFY_ORDER_FIELDS = `
  id
  legacyResourceId
  name
  email
  phone
  customer {
    legacyResourceId
    email
    phone
    firstName
    lastName
    defaultAddress {
      firstName
      lastName
      phone
      address1
      address2
      city
      province
      provinceCode
      zip
      country
      countryCodeV2
    }
  }
  billingAddress {
    firstName
    lastName
    phone
    address1
    address2
    city
    province
    provinceCode
    zip
    country
    countryCodeV2
  }
  shippingAddress {
    firstName
    lastName
    phone
    address1
    address2
    city
    province
    provinceCode
    zip
    country
    countryCodeV2
  }
`;

async function shopifyAdminGraphql(
  shop: string,
  query: string,
  variables: Record<string, unknown>
) {
  const clean = cleanShop(shop);
  const accessToken = await getShopifyAccessToken(clean);

  if (!accessToken) {
    return null;
  }

  const url = `https://${clean}/admin/api/${getAdminApiVersion()}/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    return null;
  }

  const result = await response.json().catch(() => null);

  if (
    !result ||
    typeof result !== "object" ||
    !result.data ||
    (Array.isArray(result.errors) && result.errors.length > 0)
  ) {
    return null;
  }

  return result.data as Record<string, unknown>;
}

async function fetchShopifyOrder(shop: string, transactionId: string) {
  const orderId = String(transactionId || "").trim();

  if (!orderId) {
    return null;
  }

  if (/^\d+$/.test(orderId)) {
    const direct = await shopifyAdminGraphql(
      shop,
      `query OrderById($id: ID!) {
        order(id: $id) {
          ${SHOPIFY_ORDER_FIELDS}
        }
      }`,
      { id: `gid://shopify/Order/${orderId}` }
    );

    if (direct?.order && typeof direct.order === "object") {
      return direct.order as Record<string, unknown>;
    }
  }

  const orderName = orderId.startsWith("#") ? orderId : `#${orderId}`;

  const search = await shopifyAdminGraphql(
    shop,
    `query OrderByName($query: String!) {
      orders(first: 1, query: $query) {
        nodes {
          ${SHOPIFY_ORDER_FIELDS}
        }
      }
    }`,
    { query: `name:${orderName}` }
  );

  const orders = search?.orders as Record<string, unknown> | undefined;
  const nodes = orders?.nodes;

  if (Array.isArray(nodes) && nodes[0] && typeof nodes[0] === "object") {
    return nodes[0] as Record<string, unknown>;
  }

  return null;
}

function customerFromShopifyOrder(order: Record<string, unknown>) {
  const customer = (order.customer || {}) as Record<string, unknown>;
  const shippingAddress = (order.shippingAddress || {}) as Record<string, unknown>;
  const billingAddress = (order.billingAddress || {}) as Record<string, unknown>;
  const defaultAddress = (customer.defaultAddress || {}) as Record<string, unknown>;
  const address = Object.keys(shippingAddress).length
    ? shippingAddress
    : Object.keys(billingAddress).length
      ? billingAddress
      : defaultAddress;

  return {
    email: firstValue(order.email, customer.email),
    phone: firstValue(
      order.phone,
      customer.phone,
      shippingAddress.phone,
      billingAddress.phone,
      defaultAddress.phone
    ),
    first_name: firstValue(
      customer.firstName,
      shippingAddress.firstName,
      billingAddress.firstName,
      defaultAddress.firstName
    ),
    last_name: firstValue(
      customer.lastName,
      shippingAddress.lastName,
      billingAddress.lastName,
      defaultAddress.lastName
    ),
    customer_id: firstValue(customer.legacyResourceId),
    address,
  };
}

export async function enrichShopifyOrderCustomer(
  event: NormalizedTrackingEvent,
  shop?: string | null
): Promise<NormalizedTrackingEvent> {
  try {
    if (!shop || event.event_name !== "purchase") {
      return event;
    }

    const transactionId = getTransactionId(event);

    if (!transactionId) {
      return event;
    }

    if (hasCustomerIdentity(event.customer)) {
      return event;
    }

    const order = await fetchShopifyOrder(shop, transactionId);

    if (!order) {
      return event;
    }

    const orderCustomer = customerFromShopifyOrder(order);
    const customer = mergeCustomer(event.customer, orderCustomer);

    return {
      ...event,
      customer,
    };
  } catch (error) {
    return event;
  }
}
