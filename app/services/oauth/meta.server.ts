// Meta (Facebook) OAuth service for Pixel and Conversions API
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI;

if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
  console.warn("Meta OAuth credentials not configured");
}

// Meta permissions for business integrations
const META_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "email",
  "pages_show_list",
  "pages_read_engagement",
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
  });

  return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeMetaCode(code: string): Promise<{
  accessToken: string;
  expiresAt: Date;
  userId: string;
}> {
  try {
    // Exchange code for short-lived token
    const tokenResponse = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
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

    // Exchange short-lived token for long-lived token (60 days)
    const longLivedResponse = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
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

    // Get user info
    const userResponse = await axios.get("https://graph.facebook.com/me", {
      params: {
        access_token: longLivedToken,
        fields: "id,email,name",
      },
    });

    const expiresAt = new Date(Date.now() + longLivedExpires * 1000);

    return {
      accessToken: longLivedToken,
      expiresAt,
      userId: userResponse.data.id,
    };
  } catch (error) {
    console.error("Error exchanging Meta code:", error);
    throw new Error("Failed to exchange authorization code");
  }
}

/**
 * Refresh Meta access token (extend long-lived token)
 */
export async function refreshMetaToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const connection = await getPlatformConnection(connectionId);

  if (!connection) {
    throw new Error("Connection not found");
  }

  try {
    // Exchange current token for new long-lived token
    const response = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
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

    // Update connection with new token
    await updateConnectionTokens(connectionId, {
      accessToken: newToken,
      tokenExpiresAt: expiresAt,
    });

    return {
      accessToken: newToken,
      expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing Meta token:", error);
    throw new Error("Failed to refresh access token");
  }
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
    const response = await axios.get("https://graph.facebook.com/v18.0/me/adaccounts", {
      params: {
        access_token: accessToken,
        fields: "id,name,account_status",
      },
    });

    return response.data.data.map((account: { id: string; name: string }) => ({
      accountId: account.id,
      name: account.name,
    }));
  } catch (error) {
    console.error("Error getting Meta ad accounts:", error);
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
    const response = await axios.get("https://graph.facebook.com/v18.0/me/accounts", {
      params: {
        access_token: accessToken,
        fields: "id,name,access_token",
      },
    });

    return response.data.data.map((page: { id: string; name: string }) => ({
      pageId: page.id,
      name: page.name,
    }));
  } catch (error) {
    console.error("Error getting Meta pages:", error);
    return [];
  }
}

/**
 * Get Meta Pixel for an ad account
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
      `https://graph.facebook.com/v18.0/${adAccountId}/adspixels`,
      {
        params: {
          access_token: accessToken,
          fields: "id,name",
        },
      }
    );

    return response.data.data.map((pixel: { id: string; name: string }) => ({
      pixelId: pixel.id,
      name: pixel.name,
    }));
  } catch (error) {
    console.error("Error getting Meta pixels:", error);
    return [];
  }
}
