type ShopifyAdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type MarketingMethod = "all" | "free_listings" | "shopping_ads";
type ProductChannel = "online" | "local";

type ShopifyVariantFeedItem = {
  productId: string;
  variantId: string;
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink?: string;
  brand?: string;
  sku?: string;
  barcode?: string;
  price: string;
  currency: string;
  availability: "in stock";
};

type CreateMerchantCenterFeedInput = {
  admin: ShopifyAdminClient;
  accessToken: string;
  merchantId: string;
  shop: string;
  limit?: number;
  targetCountry?: string;
  contentLanguage?: string;
  productIdFormat?: string;
  channel?: ProductChannel;
  marketingMethod?: MarketingMethod;
  includeRestrictedProducts?: boolean;
  scheduleInterval?: string;
};

const RESTRICTED_PRODUCT_KEYWORDS = [
  "adult",
  "sex",
  "sexual",
  "sexy",
  "erotic",
  "porn",
  "pornographic",
  "nude",
  "nudity",
  "xxx",
  "dildo",
  "vibrator",
  "masturbator",
  "lingerie",
  "bdsm",
  "fetish",
  "condom",
  "aphrodisiac",
  "intimate",
  "pleasure",
];

function stripHtml(value: string) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gidNumber(gid: string) {
  return String(gid || "").split("/").pop() || String(gid || "");
}

function normalizePrice(value: unknown) {
  const price = String(value || "0").replace(/[^0-9.]/g, "");
  return price || "0";
}

function cleanCountryCode(value: string) {
  return String(value || "US")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2) || "US";
}

function buildOfferId(input: {
  format?: string;
  countryCode: string;
  productId: string;
  variantId: string;
  sku?: string;
}) {
  const format = String(input.format || "shopify_country_product_variant");

  const cleanSku = String(input.sku || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");

  if (format === "product_variant") {
    return `${input.productId}_${input.variantId}`;
  }

  if (format === "product_id") {
    return input.productId;
  }

  if (format === "variant_id") {
    return input.variantId;
  }

  if (format === "sku") {
    return cleanSku || input.variantId || input.productId;
  }

  return `Shopify_${input.countryCode}_${input.productId}_${input.variantId}`;
}

function getIncludedDestinations(marketingMethod: MarketingMethod) {
  if (marketingMethod === "free_listings") {
    return ["Free_listings"];
  }

  if (marketingMethod === "shopping_ads") {
    return ["Shopping_ads"];
  }

  return undefined;
}

function findRestrictedTerms(value: string) {
  const text = ` ${String(value || "").toLowerCase()} `;

  return RESTRICTED_PRODUCT_KEYWORDS.filter((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  });
}

async function fetchShopifyFeedItems(input: {
  admin: ShopifyAdminClient;
  shop: string;
  limit: number;
  targetCountry: string;
  productIdFormat: string;
  includeRestrictedProducts: boolean;
}): Promise<{
  items: ShopifyVariantFeedItem[];
  skippedOutOfStock: number;
  skippedRestricted: number;
}> {
  const query = `#graphql
    query DhMerchantFeedProducts($first: Int!) {
      shop {
        currencyCode
      }
      products(first: $first, query: "status:active") {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            featuredImage {
              url
              altText
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  barcode
                  price
                  inventoryQuantity
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await input.admin.graphql(query, {
    variables: {
      first: input.limit,
    },
  });

  const data: any = await response.json();

  if (data.errors?.length) {
    throw new Error(`Shopify product query failed: ${JSON.stringify(data.errors)}`);
  }

  const currency = data.data?.shop?.currencyCode || "USD";
  const products = data.data?.products?.edges || [];
  const items: ShopifyVariantFeedItem[] = [];
  let skippedOutOfStock = 0;
  let skippedRestricted = 0;

  for (const productEdge of products) {
    const product = productEdge.node;
    const variants = product.variants?.edges || [];
    const cleanDescription = stripHtml(product.descriptionHtml);

    for (const variantEdge of variants) {
      const variant = variantEdge.node;
      const inventoryQuantity = Number(variant.inventoryQuantity ?? 0);

      if (inventoryQuantity <= 0) {
        skippedOutOfStock += 1;
        continue;
      }

      const productDetailsText = [
        product.title,
        cleanDescription,
        product.vendor,
        product.productType,
        Array.isArray(product.tags) ? product.tags.join(" ") : "",
        variant.title,
        variant.sku,
        variant.barcode,
      ].join(" ");

      const restrictedMatches = findRestrictedTerms(productDetailsText);

      if (restrictedMatches.length && !input.includeRestrictedProducts) {
        skippedRestricted += 1;
        continue;
      }

      const productId = gidNumber(product.id);
      const variantId = gidNumber(variant.id) || productId;
      const offerId = buildOfferId({
        format: input.productIdFormat,
        countryCode: input.targetCountry,
        productId,
        variantId,
        sku: variant.sku || "",
      });

      const variantTitle =
        variant.title && variant.title !== "Default Title"
          ? `${product.title} - ${variant.title}`
          : product.title;

      items.push({
        productId,
        variantId,
        offerId,
        title: String(variantTitle || "").slice(0, 150),
        description: cleanDescription.slice(0, 5000) || String(product.title || ""),
        link: `https://${input.shop}/products/${product.handle}?variant=${variantId}`,
        imageLink: variant.image?.url || product.featuredImage?.url || "",
        brand: product.vendor || input.shop,
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        price: normalizePrice(variant.price),
        currency,
        availability: "in stock",
      });
    }
  }

  return {
    items,
    skippedOutOfStock,
    skippedRestricted,
  };
}


function merchantProductApiId(input: {
  channel: ProductChannel;
  contentLanguage: string;
  targetCountry: string;
  offerId: string;
}) {
  return `${input.channel}:${input.contentLanguage}:${input.targetCountry}:${input.offerId}`;
}

function normalizeCompare(value: unknown) {
  return String(value ?? "").trim();
}

function samePrice(a: any, b: any) {
  const av = Number(a?.value ?? 0);
  const bv = Number(b?.value ?? 0);
  const ac = normalizeCompare(a?.currency);
  const bc = normalizeCompare(b?.currency);

  return Math.abs(av - bv) < 0.00001 && ac === bc;
}

function sameArray(a: unknown, b: unknown) {
  const aa = Array.isArray(a) ? [...a].sort() : [];
  const bb = Array.isArray(b) ? [...b].sort() : [];

  return JSON.stringify(aa) === JSON.stringify(bb);
}

function isSameMerchantProduct(existing: any, next: Record<string, unknown>) {
  const fields = [
    "offerId",
    "title",
    "description",
    "link",
    "imageLink",
    "contentLanguage",
    "targetCountry",
    "channel",
    "availability",
    "condition",
    "brand",
    "gtin",
    "mpn",
  ];

  for (const field of fields) {
    if (normalizeCompare(existing?.[field]) !== normalizeCompare(next?.[field])) {
      return false;
    }
  }

  if (Boolean(existing?.identifierExists) !== Boolean(next?.identifierExists)) {
    return false;
  }

  if (!samePrice(existing?.price, next?.price)) {
    return false;
  }

  if (!sameArray(existing?.includedDestinations, next?.includedDestinations)) {
    return false;
  }

  return true;
}

async function getExistingMerchantProduct(input: {
  accessToken: string;
  merchantId: string;
  channel: ProductChannel;
  contentLanguage: string;
  targetCountry: string;
  offerId: string;
}) {
  const productId = merchantProductApiId({
    channel: input.channel,
    contentLanguage: input.contentLanguage,
    targetCountry: input.targetCountry,
    offerId: input.offerId,
  });

  const response = await fetch(
    `https://shoppingcontent.googleapis.com/content/v2.1/${input.merchantId}/products/${encodeURIComponent(productId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return null;
  }

  return data;
}

async function insertMerchantProduct(input: {
  accessToken: string;
  merchantId: string;
  targetCountry: string;
  contentLanguage: string;
  channel: ProductChannel;
  marketingMethod: MarketingMethod;
  item: ShopifyVariantFeedItem;
}) {
  const product: Record<string, unknown> = {
    offerId: input.item.offerId,
    title: input.item.title,
    description: input.item.description,
    link: input.item.link,
    imageLink: input.item.imageLink,
    contentLanguage: input.contentLanguage,
    targetCountry: input.targetCountry,
    channel: input.channel,
    availability: input.item.availability,
    condition: "new",
    price: {
      value: input.item.price,
      currency: input.item.currency,
    },
    brand: input.item.brand,
    identifierExists: Boolean(input.item.barcode || input.item.sku),
  };

  const includedDestinations = getIncludedDestinations(input.marketingMethod);
  if (includedDestinations) {
    product.includedDestinations = includedDestinations;
  }

  if (input.item.barcode) product.gtin = input.item.barcode;
  if (input.item.sku) product.mpn = input.item.sku;

  const existingProduct = await getExistingMerchantProduct({
    accessToken: input.accessToken,
    merchantId: input.merchantId,
    channel: input.channel,
    contentLanguage: input.contentLanguage,
    targetCountry: input.targetCountry,
    offerId: input.item.offerId,
  });

  if (existingProduct && isSameMerchantProduct(existingProduct, product)) {
    return {
      ok: true,
      skipped: true,
      reason: "unchanged",
      offerId: input.item.offerId,
      productId: existingProduct.id || input.item.offerId,
    };
  }

  const response = await fetch(
    `https://shoppingcontent.googleapis.com/content/v2.1/${input.merchantId}/products`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(product),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      offerId: input.item.offerId,
      status: response.status,
      error: data?.error?.message || JSON.stringify(data),
    };
  }

  return {
    ok: true,
    skipped: false,
    offerId: input.item.offerId,
    productId: data.id || data.offerId || input.item.offerId,
  };
}

export async function createMerchantCenterFeed(input: CreateMerchantCenterFeedInput) {
  const merchantId = String(input.merchantId || "").replace(/-/g, "").trim();

  if (!merchantId) {
    throw new Error("Merchant Center ID is required.");
  }

  const limit = Math.max(1, Math.min(Number(input.limit || 10), 50));
  const targetCountry = cleanCountryCode(input.targetCountry || "US");
  const contentLanguage = String(input.contentLanguage || "en").toLowerCase();
  const productIdFormat = String(input.productIdFormat || "shopify_country_product_variant");
  const channel = input.channel === "local" ? "local" : "online";
  const marketingMethod = ["free_listings", "shopping_ads", "all"].includes(String(input.marketingMethod))
    ? (input.marketingMethod as MarketingMethod)
    : "all";

  const feedData = await fetchShopifyFeedItems({
    admin: input.admin,
    shop: input.shop,
    limit,
    targetCountry,
    productIdFormat,
    includeRestrictedProducts: Boolean(input.includeRestrictedProducts),
  });

  if (!feedData.items.length) {
    throw new Error(
      `No eligible in-stock Shopify products found to upload. Skipped out of stock: ${feedData.skippedOutOfStock}. Skipped restricted: ${feedData.skippedRestricted}.`
    );
  }

  const results = [];

  for (const item of feedData.items) {
    results.push(
      await insertMerchantProduct({
        accessToken: input.accessToken,
        merchantId,
        targetCountry,
        contentLanguage,
        channel,
        marketingMethod,
        item,
      })
    );
  }

  const skippedUnchanged = results.filter((result: any) => result.skipped).length;
  const uploaded = results.filter((result: any) => result.ok && !result.skipped).length;
  const failed = results.filter((result: any) => !result.ok).length;

  return {
    merchantId,
    targetCountry,
    contentLanguage,
    productIdFormat,
    channel,
    marketingMethod,
    includeRestrictedProducts: Boolean(input.includeRestrictedProducts),
    scheduleInterval: String(input.scheduleInterval || "manual"),
    total: results.length,
    uploaded,
    skippedUnchanged,
    failed,
    skippedOutOfStock: feedData.skippedOutOfStock,
    skippedRestricted: feedData.skippedRestricted,
    sampleOfferIds: results.slice(0, 5).map((result: any) => result.offerId),
    results,
  };
}
