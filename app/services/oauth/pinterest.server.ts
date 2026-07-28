// Pinterest OAuth service for Tag and Conversions API
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const PINTEREST_REDIRECT_URI = process.env.PINTEREST_REDIRECT_URI;

if (!PINTEREST_APP_ID || !PINTEREST_APP_SECRET || !PINTEREST_REDIRECT_URI) {
  console.warn("Pinterest OAuth credentials not configured");
}

const PINTEREST_SCOPES = "ads:read,user_accounts:read,catalogs:read";

/**
 * Generate Pinterest OAuth authorization URL
 */
export function getPinterestAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: PINTEREST_APP_ID || "",
    redirect_uri: PINTEREST_REDIRECT_URI || "",
    response_type: "code",
    scope: PINTEREST_SCOPES,
    state,
  });

  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangePinterestCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  try {
    const response = await axios.post(
      "https://api.pinterest.com/v5/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: PINTEREST_REDIRECT_URI || "",
      }),
      {
        auth: {
          username: PINTEREST_APP_ID || "",
          password: PINTEREST_APP_SECRET || "",
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
    };
  } catch (error) {
    console.error("Error exchanging Pinterest code:", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Failed to exchange authorization code");
  }
}

/**
 * Refresh Pinterest access token
 */
export async function refreshPinterestToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const connection = await getPlatformConnection(connectionId);

  if (!connection || !connection.decryptedRefreshToken) {
    throw new Error("Connection not found or no refresh token available");
  }

  try {
    const response = await axios.post(
      "https://api.pinterest.com/v5/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.decryptedRefreshToken,
      }),
      {
        auth: {
          username: PINTEREST_APP_ID || "",
          password: PINTEREST_APP_SECRET || "",
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update connection with new tokens
    await updateConnectionTokens(connectionId, {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: expiresAt,
    });

    return {
      accessToken: access_token,
      expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing Pinterest token:", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Failed to refresh access token");
  }
}

/**
 * Get Pinterest Ad Accounts
 */
export async function getPinterestAdAccounts(accessToken: string): Promise<
  Array<{
    accountId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get("https://api.pinterest.com/v5/ad_accounts", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data.items.map((account: { id: string; name: string }) => ({
      accountId: account.id,
      name: account.name,
    }));
  } catch (error) {
    console.error("Error getting Pinterest ad accounts:", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}
