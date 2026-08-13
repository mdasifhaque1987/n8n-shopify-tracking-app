// Google OAuth service for Ads and Analytics
import { google } from "googleapis";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";
import { discoverGa4Properties } from "../ga4-property-discovery.server";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.warn("Google OAuth credentials not configured");
}

// Google OAuth scopes for Ads and Analytics
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/adwords", // Google Ads
  "https://www.googleapis.com/auth/analytics.readonly", // GA4
  "https://www.googleapis.com/auth/userinfo.email", // Email
  "https://www.googleapis.com/auth/userinfo.profile", // Profile
  "https://www.googleapis.com/auth/content", // Merchant Center / Shopping Content API,
  "https://www.googleapis.com/auth/datamanager",
];

/**
 * Create OAuth2 client
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}


function createGoogleApiError(
  message: string,
  status: number,
  details?: unknown
): Error & { status: number; details?: unknown } {
  const error = new Error(message) as Error & {
    status: number;
    details?: unknown;
  };

  error.status = status;
  error.details = details;

  return error;
}

function getGoogleApiErrorStatus(error: unknown): number {
  if (!error || typeof error !== "object") {
    return 0;
  }

  const candidate = error as {
    status?: number | string;
    code?: number | string;
    response?: {
      status?: number | string;
    };
  };

  const rawStatus =
    candidate.response?.status ??
    candidate.status ??
    candidate.code ??
    0;

  const status = Number(rawStatus);

  return Number.isFinite(status) ? status : 0;
}

type GoogleOAuthErrorShape = {
  response?: {
    data?: {
      error_description?: unknown;
      error?: unknown;
    };
  };
  message?: unknown;
};

type GoogleAdsAccountsResponse = {
  resourceNames?: string[];
  error?: unknown;
};

type MerchantAccountIdentifier = {
  merchantId?: string | number;
  aggregatorId?: string | number;
  accountId?: string | number;
};

type MerchantCentersResponse = {
  accountIdentifiers?: MerchantAccountIdentifier[];
  error?: unknown;
};

type Ga4DataStreamApiItem = {
  type?: string;
  name?: string;
  displayName?: string;
  webStreamData?: {
    measurementId?: string;
    defaultUri?: string;
  };
};

type Ga4DataStreamsResponse = {
  dataStreams?: Ga4DataStreamApiItem[];
};

/**
 * Generate Google OAuth authorization URL
 */
export function getGoogleAuthUrl(state: string): string {
  const oauth2Client = createOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // Get refresh token
    scope: GOOGLE_SCOPES,
    state: state, // Include state for CSRF protection
    prompt: "consent", // Force consent screen to always get refresh token
  });

  return authUrl;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  email: string;
  customerId?: string;
}> {
  const oauth2Client = createOAuth2Client();

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Failed to get tokens from Google");
    }

    // Set credentials
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Calculate expiration
    const expiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      email: userInfo.data.email || "",
    };
  } catch (error: unknown) {
    console.error("Google token exchange failed", {
      status: getGoogleApiErrorStatus(error),
      category: "token_exchange_failed",
    });

    const candidate = error as GoogleOAuthErrorShape;

    const details =
      candidate.response?.data?.error_description ??
      candidate.response?.data?.error ??
      candidate.message ??
      "Unknown Google token exchange error";

    throw new Error(
      `Failed to exchange authorization code: ${String(details)}`
    );
  }
}

/**
 * Refresh Google access token
 */
export async function refreshGoogleToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const connection = await getPlatformConnection(connectionId);

  if (!connection || !connection.decryptedRefreshToken) {
    throw new Error("Connection not found or no refresh token available");
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: connection.decryptedRefreshToken,
  });

  try {
    // Refresh the token
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("Failed to refresh token");
    }

    const expiresAt = new Date(
      Date.now() + (credentials.expiry_date || Date.now() + 3600 * 1000)
    );

    // Update connection with new token
    await updateConnectionTokens(connectionId, {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || connection.decryptedRefreshToken,
      tokenExpiresAt: expiresAt,
    });

    return {
      accessToken: credentials.access_token,
      expiresAt,
    };
  } catch (error) {
    console.error("Google token refresh failed", {
      status: getGoogleApiErrorStatus(error),
      category: "token_refresh_failed",
    });
    throw new Error("Failed to refresh access token");
  }
}

export class GoogleAdsDiscoveryError extends Error {
  status: number;
  category: string;

  constructor(
    message: string,
    status = 0,
    category = "google_ads_api_error"
  ) {
    super(message);
    this.name = "GoogleAdsDiscoveryError";
    this.status = status;
    this.category = category;
  }
}

/**
 * Get Google Ads accounts for a user
 */
export async function getGoogleAdsAccounts(
  accessToken: string,
  cachedAccounts: Array<{
    value: string;
    label: string;
    loginCustomerId?: string;
    manager?: boolean;
    status?: string;
  }> = []
): Promise<
  Array<{
    customerId: string;
    descriptiveName: string;
    manager: boolean;
    status: string;
    loginCustomerId?: string;
  }>
> {
  const developerToken =
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  const apiVersion =
    process.env.GOOGLE_ADS_API_VERSION || "v24";

  if (!developerToken) {
    throw new GoogleAdsDiscoveryError(
      "Google Ads API developer token is not configured.",
      500,
      "developer_token_missing"
    );
  }

  const googleAdsBaseUrl =
    ["https:", "", "googleads.googleapis.com"]
      .join("/");

  const getCachedName = (
    customerId: string,
    label: string
  ) => {
    const genericLabel =
      `Google Ads Account ${customerId}`;

    const normalizedLabel =
      String(label || "").trim();

    if (
      !normalizedLabel ||
      normalizedLabel === genericLabel
    ) {
      return "";
    }

    const idSuffix =
      ` (${customerId})`;

    if (
      normalizedLabel.endsWith(idSuffix)
    ) {
      return normalizedLabel
        .slice(
          0,
          normalizedLabel.length -
            idSuffix.length
        )
        .trim();
    }

    return normalizedLabel;
  };

  try {
    /*
     * FIRST STAGE
     *
     * Exactly one listAccessibleCustomers operation.
     */
    const response = await fetch(
      `${googleAdsBaseUrl}/${apiVersion}/customers:listAccessibleCustomers`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          "developer-token":
            developerToken,
        },
      }
    );

    const data = await response
      .json()
      .catch(() => ({})) as {
        resourceNames?: string[];
        error?: {
          message?: string;
        };
      };

    if (!response.ok) {
      const category =
        response.status === 429
          ? "rate_limited"
          : response.status === 403
            ? "permission_denied"
            : "google_ads_api_error";

      console.warn(
        "[Google Ads Discovery] listAccessibleCustomers failed",
        {
          status: response.status,
          category,
        }
      );

      if (response.status === 401) {
        throw createGoogleApiError(
          "Google Ads access token was rejected.",
          401,
          data
        );
      }

      if (response.status === 429) {
        throw new GoogleAdsDiscoveryError(
          "Google Ads API quota is exhausted. The previously cached account list has been preserved.",
          429,
          "rate_limited"
        );
      }

      if (response.status === 403) {
        throw new GoogleAdsDiscoveryError(
          "Google Ads API access was denied. Check the developer token and Google Ads permissions.",
          403,
          "permission_denied"
        );
      }

      throw new GoogleAdsDiscoveryError(
        data?.error?.message ||
          "Google Ads accounts could not be loaded.",
        response.status,
        category
      );
    }

    const customerIds =
      Array.from(
        new Set(
          (data.resourceNames || [])
            .map((resourceName) =>
              String(resourceName || "")
                .replace(/^customers\//, "")
                .replace(/-/g, "")
                .trim()
            )
            .filter(Boolean)
        )
      ).sort();

    console.info(
      "[Google Ads Discovery] Direct accessible customers",
      {
        count: customerIds.length,
      }
    );

    /*
     * Reuse previously enriched account information.
     */
    const cachedById =
      new Map(
        cachedAccounts.map((account) => [
          String(account.value || "")
            .replace(/-/g, "")
            .trim(),
          account,
        ])
      );

    const metadata =
      new Map<
        string,
        {
          descriptiveName: string;
          manager: boolean;
          status: string;
          loginCustomerId: string;
        }
      >();

    for (const customerId of customerIds) {
      const cached =
        cachedById.get(customerId);

      if (!cached) {
        continue;
      }

      const cachedName =
        getCachedName(
          customerId,
          cached.label
        );

      if (!cachedName) {
        continue;
      }

      metadata.set(
        customerId,
        {
          descriptiveName:
            cachedName,
          manager:
            Boolean(cached.manager),
          status:
            String(
              cached.status ||
              "ACCESSIBLE"
            ),
          loginCustomerId:
            String(
              cached.loginCustomerId ||
              ""
            ),
        }
      );
    }

    const missingCustomerIds =
      customerIds.filter(
        (customerId) =>
          !metadata.has(customerId)
      );

    /*
     * SECOND STAGE - NAME ENRICHMENT
     *
     * Only accounts whose human-readable name is missing
     * are queried.
     *
     * Existing cached names are never queried again.
     *
     * Limit enrichment per OAuth cycle so a merchant with
     * hundreds of directly-accessible accounts cannot create
     * another API request storm.
     */
    const nameEnrichmentIds =
      missingCustomerIds.slice(0, 25);

    console.info(
      "[Google Ads Discovery] Name enrichment",
      {
        accessible:
          customerIds.length,
        cached:
          metadata.size,
        missing:
          missingCustomerIds.length,
        querying:
          nameEnrichmentIds.length,
      }
    );

    for (
      const customerId of
      nameEnrichmentIds
    ) {
      const detailResponse =
        await fetch(
          `${googleAdsBaseUrl}/${apiVersion}/customers/${customerId}/googleAds:search`,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
              "developer-token":
                developerToken,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              query:
                "SELECT customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer LIMIT 1",
            }),
          }
        );

      const detailData =
        await detailResponse
          .json()
          .catch(() => ({})) as {
            results?: Array<{
              customer?: {
                id?: string;
                descriptiveName?: string;
                manager?: boolean;
                status?: string;
              };
            }>;
            error?: {
              message?: string;
            };
          };

      if (
        detailResponse.status === 429
      ) {
        console.warn(
          "[Google Ads Discovery] Name enrichment stopped by quota",
          {
            customerId,
          }
        );

        /*
         * Stop immediately. Generic IDs remain usable,
         * and successful names already collected remain
         * available for caching.
         */
        break;
      }

      if (
        detailResponse.status === 401
      ) {
        throw createGoogleApiError(
          "Google Ads access token was rejected while loading account names.",
          401,
          detailData
        );
      }

      if (!detailResponse.ok) {
        console.warn(
          "[Google Ads Discovery] Account name unavailable",
          {
            customerId,
            status:
              detailResponse.status,
          }
        );

        continue;
      }

      const customer =
        detailData.results?.[0]
          ?.customer;

      const descriptiveName =
        String(
          customer?.descriptiveName ||
          ""
        ).trim();

      if (!descriptiveName) {
        continue;
      }

      metadata.set(
        customerId,
        {
          descriptiveName,
          manager:
            Boolean(
              customer?.manager
            ),
          status:
            String(
              customer?.status ||
              "ACCESSIBLE"
            ),
          loginCustomerId:
            "",
        }
      );
    }

    return customerIds.map(
      (customerId) => {
        const detail =
          metadata.get(customerId);

        return {
          customerId,

          descriptiveName:
            detail?.descriptiveName ||
            `Google Ads Account ${customerId}`,

          manager:
            detail?.manager ??
            false,

          status:
            detail?.status ||
            "ACCESSIBLE",

          loginCustomerId:
            detail?.loginCustomerId ||
            "",
        };
      }
    );
  } catch (error) {
    if (
      error instanceof
        GoogleAdsDiscoveryError ||
      getGoogleApiErrorStatus(error) === 401
    ) {
      throw error;
    }

    console.error(
      "[Google Ads Discovery] Unexpected failure",
      {
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      }
    );

    throw new GoogleAdsDiscoveryError(
      "Google Ads accounts could not be loaded.",
      0,
      "google_ads_api_error"
    );
  }
}


export async function getMerchantCenters(
  accessToken: string,
  cachedCenters: Array<{
    value: string;
    label: string;
  }> = []
): Promise<
  Array<{
    merchantId: string;
    name: string;
  }>
> {
  const merchantApiBaseUrl =
    [
      "https:",
      "",
      "merchantapi.googleapis.com",
    ].join("/");

  const contentApiBaseUrl =
    [
      "https:",
      "",
      "shoppingcontent.googleapis.com",
    ].join("/");

  const getCachedMerchantName = (
    merchantId: string
  ) => {
    const cached =
      cachedCenters.find(
        (account) =>
          String(
            account.value || ""
          ).trim() === merchantId
      );

    const label =
      String(
        cached?.label || ""
      ).trim();

    if (!label) {
      return "";
    }

    const genericName =
      `Merchant Center ${merchantId}`;

    const genericLabel =
      `${genericName} (${merchantId})`;

    if (
      label === genericName ||
      label === genericLabel
    ) {
      return "";
    }

    const suffix =
      ` (${merchantId})`;

    if (label.endsWith(suffix)) {
      return label
        .slice(
          0,
          label.length -
            suffix.length
        )
        .trim();
    }

    return label;
  };


  /*
   * PRIMARY:
   * Current Merchant API.
   */
  try {
    const accounts: Array<{
      merchantId: string;
      name: string;
    }> = [];

    let pageToken = "";

    for (
      let page = 0;
      page < 10;
      page += 1
    ) {
      const params =
        new URLSearchParams();

      params.set(
        "pageSize",
        "500"
      );

      if (pageToken) {
        params.set(
          "pageToken",
          pageToken
        );
      }

      const response =
        await fetch(
          `${merchantApiBaseUrl}/accounts/v1/accounts?${params.toString()}`,
          {
            method: "GET",
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
            },
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({})) as {
            accounts?: Array<{
              name?: string;
              accountId?: string;
              accountName?: string;
            }>;
            nextPageToken?: string;
          };

      if (!response.ok) {
        if (
          response.status === 401
        ) {
          throw createGoogleApiError(
            "Merchant Center access token was rejected.",
            response.status,
            data
          );
        }

        console.warn(
          "[Merchant Center Discovery] Merchant API unavailable; using compatibility fallback",
          {
            status:
              response.status,
          }
        );

        break;
      }

      for (
        const account of
        data.accounts || []
      ) {
        const merchantId =
          String(
            account.accountId ||
            account.name
              ?.replace(
                /^accounts\//,
                ""
              ) ||
            ""
          ).trim();

        if (!merchantId) {
          continue;
        }

        const accountName =
          String(
            account.accountName ||
            ""
          ).trim();

        accounts.push({
          merchantId,
          name:
            accountName ||
            getCachedMerchantName(
              merchantId
            ) ||
            `Merchant Center ${merchantId}`,
        });
      }

      pageToken =
        String(
          data.nextPageToken ||
          ""
        );

      if (!pageToken) {
        break;
      }
    }

    if (accounts.length > 0) {
      const unique =
        Array.from(
          new Map(
            accounts.map(
              (account) => [
                account.merchantId,
                account,
              ]
            )
          ).values()
        );

      console.info(
        "[Merchant Center Discovery] Merchant API completed",
        {
          accounts:
            unique.length,
        }
      );

      return unique;
    }
  } catch (error) {
    if (
      getGoogleApiErrorStatus(
        error
      ) === 401
    ) {
      throw error;
    }

    console.warn(
      "[Merchant Center Discovery] Merchant API failed; using compatibility fallback",
      {
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      }
    );
  }


  /*
   * COMPATIBILITY FALLBACK:
   *
   * Individual:
   *   merchantId only
   *
   * Advanced account:
   *   aggregatorId only
   *
   * Subaccount:
   *   merchantId + aggregatorId
   *
   * accounts.get needs:
   *
   *   managingAccountId
   *   accountId
   */
  try {
    const authResponse =
      await fetch(
        `${contentApiBaseUrl}/content/v2.1/accounts/authinfo`,
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        }
      );

    const authData =
      await authResponse
        .json()
        .catch(() => ({})) as
        MerchantCentersResponse;

    if (!authResponse.ok) {
      if (
        authResponse.status === 401
      ) {
        throw createGoogleApiError(
          "Merchant Center access token was rejected.",
          authResponse.status,
          authData
        );
      }

      console.warn(
        "[Merchant Center Discovery] authinfo failed",
        {
          status:
            authResponse.status,
        }
      );

      return [];
    }

    const identifiers =
      authData.accountIdentifiers ||
      [];

    const resolved: Array<{
      merchantId: string;
      name: string;
    }> = [];

    let cachedCount = 0;
    let enrichedCount = 0;
    let unresolvedCount = 0;

    for (
      const identifier of
      identifiers
    ) {
      const merchantId =
        String(
          identifier.merchantId ||
          ""
        ).trim();

      const aggregatorId =
        String(
          identifier.aggregatorId ||
          ""
        ).trim();

      /*
       * Individual:
       *
       * merchantId = account
       * managing ID = merchantId
       *
       * Advanced account:
       *
       * aggregatorId = account
       * managing ID = aggregatorId
       *
       * Subaccount:
       *
       * merchantId = subaccount
       * aggregatorId = managing advanced account
       */
      const accountId =
        merchantId ||
        aggregatorId;

      /*
       * Use the account itself first.
       *
       * This is the lookup pattern that already resolved all
       * 16 accessible Merchant Center account names
       * successfully in production.
       *
       * Using aggregatorId first caused 401 responses for
       * accounts that were otherwise directly readable.
       */
      const managingAccountId =
        accountId;

      if (
        !accountId ||
        !managingAccountId
      ) {
        continue;
      }

      let accountName =
        getCachedMerchantName(
          accountId
        );

      if (accountName) {
        cachedCount += 1;
      } else {
        try {
          const detailUrl =
            `${contentApiBaseUrl}/content/v2.1/${managingAccountId}/accounts/${accountId}?view=merchant`;

          const detailResponse =
            await fetch(
              detailUrl,
              {
                method: "GET",
                headers: {
                  Authorization:
                    `Bearer ${accessToken}`,
                },
              }
            );

          const detailData =
            await detailResponse
              .json()
              .catch(() => ({})) as {
                id?: string;
                name?: string;
              };

          const detailName =
            String(
              detailData.name ||
              ""
            ).trim();

          if (
            detailResponse.ok &&
            detailName
          ) {
            accountName =
              detailName;

            enrichedCount += 1;

            console.info(
              "[Merchant Center Discovery] Account name resolved",
              {
                accountId,
                managingAccountId,
              }
            );
          } else {
            unresolvedCount += 1;

            console.warn(
              "[Merchant Center Discovery] Account name unavailable",
              {
                accountId,
                managingAccountId,
                status:
                  detailResponse.status,
              }
            );
          }
        } catch (error) {
          unresolvedCount += 1;

          console.warn(
            "[Merchant Center Discovery] Account name request failed",
            {
              accountId,
              managingAccountId,
              errorName:
                error instanceof Error
                  ? error.name
                  : "UnknownError",
            }
          );
        }
      }

      resolved.push({
        merchantId:
          accountId,

        name:
          accountName ||
          `Merchant Center ${accountId}`,
      });
    }

    console.info(
      "[Merchant Center Discovery] Name enrichment completed",
      {
        accessible:
          resolved.length,
        cached:
          cachedCount,
        enriched:
          enrichedCount,
        unresolved:
          unresolvedCount,
      }
    );

    return resolved;
  } catch (error) {
    if (
      getGoogleApiErrorStatus(
        error
      ) === 401
    ) {
      throw error;
    }

    console.error(
      "[Merchant Center Discovery] Fallback failed",
      {
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      }
    );

    return [];
  }
}


/**
 * Get Google Analytics properties
 */
export async function getGoogleAnalyticsProperties(
  accessToken: string
) {
  return discoverGa4Properties(accessToken);
}


export type Ga4DataStreamOption = {
  streamId: string;
  displayName: string;
  measurementId: string;
  propertyId: string;
};

export async function getGoogleAnalyticsDataStreams(
  accessToken: string,
  propertyId: string
): Promise<Ga4DataStreamOption[]> {
  const cleanPropertyId = String(propertyId || "").replace(/^properties\//, "").trim();

  if (!cleanPropertyId) {
    return [];
  }

  try {
    const response = await fetch(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${cleanPropertyId}/dataStreams`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.warn("GA4 data stream discovery failed", {
        status: response.status,
        category: "ga4_data_stream_api_error",
      });

      if (response.status === 401) {
        throw createGoogleApiError(
          "GA4 data streams access token was rejected.",
          response.status,
          undefined
        );
      }

      return [];
    }

    const data =
      (await response.json()) as Ga4DataStreamsResponse;

    return (data.dataStreams || [])
      .filter(
        (stream) =>
          stream.type === "WEB_DATA_STREAM" &&
          Boolean(stream.webStreamData?.measurementId)
      )
      .map((stream) => {
        const streamName = String(stream.name || "");
        const measurementId = String(
          stream.webStreamData?.measurementId || ""
        );

        return {
          streamId:
            streamName.split("/").pop() ||
            streamName ||
            measurementId,
          displayName:
            stream.displayName ||
            stream.webStreamData?.defaultUri ||
            streamName ||
            measurementId,
          measurementId,
          propertyId: cleanPropertyId,
        };
      });
  } catch (error) {
    if (getGoogleApiErrorStatus(error) === 401) {
      throw error;
    }

    console.warn("Failed to load GA4 data streams", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}
