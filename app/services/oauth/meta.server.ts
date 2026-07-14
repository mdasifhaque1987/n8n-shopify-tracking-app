/* eslint-disable @typescript-eslint/no-explicit-any */
// Meta (Facebook) OAuth service for Pixel and Conversions API
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI;
const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v18.0";


type MetaPagedGraphResponse = {
  data: {
    data?: Array<{
      id?: string;
      name?: string;
    }>;
    paging?: {
      next?: string | null;
    };
  };
};

if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
  console.warn("Meta OAuth credentials not configured");
}

// Meta permissions for business integrations
// Removed "email" because Meta is rejecting it for this app.
// For Pixel, CAPI, ad accounts, and business assets, email is not required.
const META_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
].join(",");

/**
 * Generate Meta OAuth authorization URL
 */
export function getMetaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID || "",
    redirect_uri: META_REDIRECT_URI || "",
    state,
    scope: META_SCOPES,
    response_type: "code",

    // Force Facebook to confirm the user's identity on connect/reconnect.
    // This helps merchants intentionally choose the correct Meta account and business access.
    auth_type: "reauthenticate",
    auth_nonce: state,
  });

  return `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeMetaCode(code: string): Promise<{
  accessToken: string;
  expiresAt: Date;
  userId: string;
  userName: string;
}> {
  try {
    // Exchange code for short-lived token
    const tokenResponse = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          redirect_uri: META_REDIRECT_URI,
          code,
        },
      }
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error("Meta did not return an access token.");
    }

    // Exchange short-lived token for long-lived token
    const longLivedResponse = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          fb_exchange_token: access_token,
        },
      }
    );

    const longLivedToken = longLivedResponse.data.access_token;
    const longLivedExpires = longLivedResponse.data.expires_in || 5184000; // 60 days default

    if (!longLivedToken) {
      throw new Error("Meta did not return a long-lived access token.");
    }

    // Get Meta user info
    const userResponse = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me`,
      {
        params: {
          access_token: longLivedToken,
          fields: "id,name",
        },
      }
    );

    const expiresAt = new Date(Date.now() + longLivedExpires * 1000);

    return {
      accessToken: longLivedToken,
      expiresAt,
      userId: userResponse.data.id,
      userName: userResponse.data.name || userResponse.data.id,
    };
  } catch (error: any) {
    console.error("Error exchanging Meta code:", error?.response?.data || error);

    const details =
      error?.response?.data?.error?.message ||
      error?.response?.data?.error_description ||
      error?.message ||
      "Unknown Meta OAuth error";

    throw new Error(`Failed to exchange authorization code: ${details}`);
  }
}

/**
 * Refresh Meta access token
 */
export async function refreshMetaToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const connection = await getPlatformConnection(connectionId);

  if (!connection) {
    throw new Error("Connection not found");
  }

  try {
    const response = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          fb_exchange_token: connection.decryptedAccessToken,
        },
      }
    );

    const newToken = response.data.access_token;
    const expiresIn = response.data.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (!newToken) {
      throw new Error("Meta did not return a refreshed access token.");
    }

    await updateConnectionTokens(connectionId, {
      accessToken: newToken,
      tokenExpiresAt: expiresAt,
    });

    return {
      accessToken: newToken,
      expiresAt,
    };
  } catch (error: any) {
    console.error("Error refreshing Meta token:", error?.response?.data || error);

    const details =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown Meta token refresh error";

    throw new Error(`Failed to refresh access token: ${details}`);
  }
}


/**
 * Get Meta Business Portfolios
 */
export async function getMetaBusinessPortfolios(accessToken: string): Promise<
  Array<{
    businessId: string;
    name: string;
  }>
> {
  const businesses: Array<{
    businessId: string;
    name: string;
  }> = [];

  try {
    let nextUrl: string | null =
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/businesses`;

    let page = 0;

    while (nextUrl && page < 20) {
      page += 1;

      const response: MetaPagedGraphResponse = await axios.get(nextUrl, {
        params:
          page === 1
            ? {
                access_token: accessToken,
                fields: "id,name",
                limit: 100,
              }
            : undefined,
      });

      const pageBusinesses = response.data.data || [];

      for (const business of pageBusinesses) {
        if (!business?.id) continue;

        businesses.push({
          businessId: business.id,
          name: business.name || business.id,
        });
      }

      nextUrl = response.data.paging?.next || null;
    }

    const uniqueBusinesses = Array.from(
      new Map(businesses.map((business) => [business.businessId, business])).values()
    );

    console.log(
      `Loaded ${uniqueBusinesses.length} Meta Business Portfolio(s) from Graph API.`
    );

    return uniqueBusinesses;
  } catch (error: any) {
    console.error("Error getting Meta business portfolios:", error?.response?.data || error);
    return [];
  }
}


/**
 * Get Meta Datasets / Pixels for a Business Portfolio
 */
export async function getMetaDatasetsForBusiness(
  accessToken: string,
  businessId: string
): Promise<
  Array<{
    datasetId: string;
    name: string;
  }>
> {
  const datasets: Array<{
    datasetId: string;
    name: string;
  }> = [];

  const endpoints = [
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${businessId}/owned_pixels`,
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${businessId}/adspixels`,
  ];

  for (const endpoint of endpoints) {
    try {
      let nextUrl: string | null = endpoint;
      let page = 0;

      while (nextUrl && page < 20) {
        page += 1;

        const response: MetaPagedGraphResponse = await axios.get(nextUrl, {
          params:
            page === 1
              ? {
                  access_token: accessToken,
                  fields: "id,name",
                  limit: 100,
                }
              : undefined,
        });

        const pageDatasets = response.data.data || [];

        for (const dataset of pageDatasets) {
          if (!dataset?.id) continue;

          datasets.push({
            datasetId: dataset.id,
            name: dataset.name || dataset.id,
          });
        }

        nextUrl = response.data.paging?.next || null;
      }

      if (datasets.length > 0) {
        break;
      }
    } catch (error: any) {
      console.error(
        `Error loading Meta datasets from ${endpoint}:`,
        error?.response?.data || error
      );
    }
  }

  const uniqueDatasets = Array.from(
    new Map(datasets.map((dataset) => [dataset.datasetId, dataset])).values()
  );

  console.log(
    `Loaded ${uniqueDatasets.length} Meta Dataset / Pixel asset(s) for business ${businessId}.`
  );

  return uniqueDatasets;
}

/**
 * Get Meta Ad Accounts
 */
export async function getMetaAdAccounts(accessToken: string): Promise<
  Array<{
    accountId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/adaccounts`,
      {
        params: {
          access_token: accessToken,
          fields: "id,name,account_status",
        },
      }
    );

    return (response.data.data || []).map((account: { id: string; name: string }) => ({
      accountId: account.id,
      name: account.name,
    }));
  } catch (error: any) {
    console.error("Error getting Meta ad accounts:", error?.response?.data || error);
    return [];
  }
}

/**
 * Get Meta Business Pages
 */
export async function getMetaPages(accessToken: string): Promise<
  Array<{
    pageId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts`,
      {
        params: {
          access_token: accessToken,
          fields: "id,name,access_token",
        },
      }
    );

    return (response.data.data || []).map((page: { id: string; name: string }) => ({
      pageId: page.id,
      name: page.name,
    }));
  } catch (error: any) {
    console.error("Error getting Meta pages:", error?.response?.data || error);
    return [];
  }
}

/**
 * Get Meta Pixels for an ad account
 */
export async function getMetaPixels(
  accessToken: string,
  adAccountId: string
): Promise<
  Array<{
    pixelId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/adspixels`,
      {
        params: {
          access_token: accessToken,
          fields: "id,name",
        },
      }
    );

    return (response.data.data || []).map((pixel: { id: string; name: string }) => ({
      pixelId: pixel.id,
      name: pixel.name,
    }));
  } catch (error: any) {
    console.error("Error getting Meta pixels:", error?.response?.data || error);
    return [];
  }
}
