export const PRICING_PLANS = {
  "core-starter": {
    key: "core-starter",
    displayName: "Core Starter",
    shopifyHandles: ["core-stater", "core-starter"],
    monthlyPriceUsd: 5,
    availableInShopify: true,
    clientSide: true,
    serverSide: false,
    platforms: {
      google: true,
      meta: true,
      tiktok: false,
      pinterest: false,
    },
  },

  "core-server": {
    key: "core-server",
    displayName: "Core Server",
    shopifyHandles: ["core-server"],
    monthlyPriceUsd: 10,
    availableInShopify: true,
    clientSide: true,
    serverSide: true,
    platforms: {
      google: true,
      meta: true,
      tiktok: false,
      pinterest: false,
    },
  },

  "growth-client": {
    key: "growth-client",
    displayName: "Growth Client",
    shopifyHandles: ["growth-client"],
    monthlyPriceUsd: 8,
    availableInShopify: false,
    clientSide: true,
    serverSide: false,
    platforms: {
      google: true,
      meta: true,
      tiktok: true,
      pinterest: false,
    },
  },

  "pro-client": {
    key: "pro-client",
    displayName: "Pro Client",
    shopifyHandles: ["pro-client"],
    monthlyPriceUsd: 11,
    availableInShopify: false,
    clientSide: true,
    serverSide: false,
    platforms: {
      google: true,
      meta: true,
      tiktok: true,
      pinterest: true,
    },
  },

  "growth-server": {
    key: "growth-server",
    displayName: "Growth Server",
    shopifyHandles: ["growth-server"],
    monthlyPriceUsd: 13,
    availableInShopify: false,
    clientSide: true,
    serverSide: true,
    platforms: {
      google: true,
      meta: true,
      tiktok: true,
      pinterest: false,
    },
  },

  "pro-server": {
    key: "pro-server",
    displayName: "Pro Server",
    shopifyHandles: ["pro-server"],
    monthlyPriceUsd: 16,
    availableInShopify: false,
    clientSide: true,
    serverSide: true,
    platforms: {
      google: true,
      meta: true,
      tiktok: true,
      pinterest: true,
    },
  },
} as const;

export type CanonicalPlanHandle = keyof typeof PRICING_PLANS;
export type PricingPlatform =
  | "google"
  | "meta"
  | "tiktok"
  | "pinterest";

const SHOPIFY_HANDLE_ALIASES: Record<string, CanonicalPlanHandle> = {
  // Current Shopify handle contains the spelling mistake.
  "core-stater": "core-starter",

  // This alias keeps the app working if the Shopify handle is corrected later.
  "core-starter": "core-starter",

  "core-server": "core-server",
  "growth-client": "growth-client",
  "pro-client": "pro-client",
  "growth-server": "growth-server",
  "pro-server": "pro-server",
};

export function normalizeShopifyPlanHandle(
  handle: string | null | undefined,
): CanonicalPlanHandle | null {
  const normalizedHandle = String(handle || "")
    .trim()
    .toLowerCase();

  return SHOPIFY_HANDLE_ALIASES[normalizedHandle] || null;
}

export function getPlanDefinition(
  handle: string | null | undefined,
) {
  const normalizedHandle = normalizeShopifyPlanHandle(handle);

  return normalizedHandle
    ? PRICING_PLANS[normalizedHandle]
    : null;
}

export function isPlanAvailableInShopify(
  handle: string | null | undefined,
): boolean {
  return Boolean(getPlanDefinition(handle)?.availableInShopify);
}

export function canUseServerSideTracking(
  handle: string | null | undefined,
): boolean {
  return Boolean(getPlanDefinition(handle)?.serverSide);
}

export function canUsePlatform(
  handle: string | null | undefined,
  platform: PricingPlatform,
): boolean {
  return Boolean(getPlanDefinition(handle)?.platforms[platform]);
}
