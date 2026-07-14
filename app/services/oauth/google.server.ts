// Google OAuth service for Ads and Analytics
import { google } from "googleapis";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

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
    console.error("Error exchanging Google code:", error);

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
    console.error("Error refreshing Google token:", error);
    throw new Error("Failed to refresh access token");
  }
}

/**
 * Get Google Ads accounts for a user
 */
export async function getGoogleAdsAccounts(
  accessToken: string
): Promise<
  Array<{
    customerId: string;
    descriptiveName: string;
  }>
> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || "v24";

  if (!developerToken) {
    console.warn("GOOGLE_ADS_DEVELOPER_TOKEN is missing");
    return [];
  }

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${apiVersion}/customers:listAccessibleCustomers`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
        },
      }
    );

    const data =
      (await response.json()) as GoogleAdsAccountsResponse;

    if (!response.ok) {
      console.error("Google Ads accounts error:", data);

      if (response.status === 401) {
        throw createGoogleApiError(
          "Google Ads access token was rejected.",
          response.status,
          data
        );
      }

      return [];
    }

    const resourceNames: string[] = data.resourceNames || [];

    return resourceNames.map((resourceName) => {
      const customerId = resourceName.replace("customers/", "");

      return {
        customerId,
        descriptiveName: `Google Ads Account ${customerId}`,
      };
    });
  } catch (error) {
    if (getGoogleApiErrorStatus(error) === 401) {
      throw error;
    }

    console.error("Error getting Google Ads accounts:", error);
    return [];
  }
}

export async function getMerchantCenters(
  accessToken: string
): Promise<
  Array<{
    merchantId: string;
    name: string;
  }>
> {
  try {
    const response = await fetch(
      "https://shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data =
      (await response.json()) as MerchantCentersResponse;

    if (!response.ok) {
      console.error("Merchant Center authinfo error:", data);

      if (response.status === 401) {
        throw createGoogleApiError(
          "Merchant Center access token was rejected.",
          response.status,
          data
        );
      }

      return [];
    }

    const accountIdentifiers = data.accountIdentifiers || [];

    return accountIdentifiers
      .map((account) => {
        const merchantId =
          account.merchantId ||
          account.aggregatorId ||
          account.accountId ||
          "";

        return {
          merchantId: String(merchantId),
          name: `Merchant Center ${merchantId}`,
        };
      })
      .filter((account: { merchantId: string }) => account.merchantId);
  } catch (error) {
    if (getGoogleApiErrorStatus(error) === 401) {
      throw error;
    }

    console.error("Error getting Merchant Centers:", error);
    return [];
  }
}

/**
 * Get Google Analytics properties
 */
export async function getGoogleAnalyticsProperties(
  accessToken: string
): Promise<
  Array<{
    propertyId: string;
    displayName: string;
  }>
> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  try {
    const analytics = google.analyticsadmin({ version: "v1beta", auth: oauth2Client });
    
    // List accounts
    const accountsResponse = await analytics.accounts.list();
    const accounts = accountsResponse.data.accounts || [];

    const properties: Array<{ propertyId: string; displayName: string }> = [];

    // Get properties for each account
    for (const account of accounts) {
      if (account.name) {
        const propertiesResponse = await analytics.properties.list({
          filter: `parent:${account.name}`,
        });

        const accountProperties = propertiesResponse.data.properties || [];
        accountProperties.forEach((prop) => {
          if (prop.name && prop.displayName) {
            properties.push({
              propertyId: prop.name.split("/").pop() || "",
              displayName: prop.displayName,
            });
          }
        });
      }
    }

    return properties;
  } catch (error) {
    if (getGoogleApiErrorStatus(error) === 401) {
      throw error;
    }

    console.error("Error getting Analytics properties:", error);
    return [];
  }
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
      const errorBody = await response.text();

      console.warn(
        "GA4 data streams API failed",
        response.status,
        errorBody
      );

      if (response.status === 401) {
        throw createGoogleApiError(
          "GA4 data streams access token was rejected.",
          response.status,
          errorBody
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

    console.warn("Failed to load GA4 data streams", error);
    return [];
  }
}
