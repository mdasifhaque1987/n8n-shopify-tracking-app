import db from "../db.server";

export type GoogleCachedAssetOption = {
  value: string;
  label: string;
  loginCustomerId?: string;
  manager?: boolean;
  status?: string;
};

const CACHE_PLATFORM = "google_cache";

const CACHE_TYPES = {
  ga4Properties: "GA4 Properties",
  googleAdsAccounts: "Google Ads Accounts",
  merchantCenters: "Merchant Centers",
} as const;

type CacheKind = keyof typeof CACHE_TYPES;


type GoogleAssetCacheRow = {
  assetType: string;
  assetValue: string;
  assetLabel: string | null;
};

function parseOptions(
  value: string | null | undefined
): GoogleCachedAssetOption[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.value === "string" &&
          typeof item.label === "string"
      )
      .map((item) => ({
        value: String(item.value),
        label: String(item.label),

        ...(item.loginCustomerId
          ? {
              loginCustomerId:
                String(item.loginCustomerId),
            }
          : {}),

        ...(typeof item.manager === "boolean"
          ? {
              manager: item.manager,
            }
          : {}),

        ...(item.status
          ? {
              status: String(item.status),
            }
          : {}),
      }));
  } catch {
    return [];
  }
}

export async function getGoogleAssetDiscoveryCache(
  workspaceId: string,
  googleAccountId: string
) {
  const rows: GoogleAssetCacheRow[] =
    await db.shopAssetSelection.findMany({
      where: {
        workspaceId,
        platform: CACHE_PLATFORM,
      },
      select: {
        assetType: true,
        assetValue: true,
        assetLabel: true,
      },
    });

  function read(kind: CacheKind) {
    const row = rows.find(
      (item) =>
        item.assetType === CACHE_TYPES[kind]
    );

    /*
     * Never expose cached assets discovered using a
     * different Google login.
     */
    if (
      !row ||
      String(row.assetLabel || "") !==
        String(googleAccountId || "")
    ) {
      return [];
    }

    return parseOptions(row.assetValue);
  }

  return {
    ga4Properties:
      read("ga4Properties"),

    googleAdsAccounts:
      read("googleAdsAccounts"),

    merchantCenters:
      read("merchantCenters"),
  };
}

export async function saveGoogleAssetDiscoveryCache(
  data: {
    workspaceId: string;
    googleAccountId: string;
    kind: CacheKind;
    options: GoogleCachedAssetOption[];
  }
) {
  return db.shopAssetSelection.upsert({
    where: {
      workspaceId_platform_assetType: {
        workspaceId: data.workspaceId,
        platform: CACHE_PLATFORM,
        assetType: CACHE_TYPES[data.kind],
      },
    },

    update: {
      assetValue:
        JSON.stringify(data.options),
      assetLabel:
        data.googleAccountId,
    },

    create: {
      workspaceId:
        data.workspaceId,

      platform:
        CACHE_PLATFORM,

      assetType:
        CACHE_TYPES[data.kind],

      assetValue:
        JSON.stringify(data.options),

      assetLabel:
        data.googleAccountId,
    },
  });
}
