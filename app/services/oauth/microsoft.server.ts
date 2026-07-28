// Microsoft Ads (Bing) OAuth service
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;

if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_REDIRECT_URI) {
  console.warn("Microsoft Ads OAuth credentials not configured");
}

const MICROSOFT_SCOPES = "https://ads.microsoft.com/msads.manage offline_access";

/**
 * Generate Microsoft Ads OAuth authorization URL
 */
export function getMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID || "",
    redirect_uri: MICROSOFT_REDIRECT_URI || "",
    response_type: "code",
    scope: MICROSOFT_SCOPES,
    state,
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeMicrosoftCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  try {
    const response = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID || "",
        client_secret: MICROSOFT_CLIENT_SECRET || "",
        code,
        redirect_uri: MICROSOFT_REDIRECT_URI || "",
        grant_type: "authorization_code",
      }),
      {
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
    console.error("Error exchanging Microsoft code:", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Failed to exchange authorization code");
  }
}

/**
 * Refresh Microsoft Ads access token
 */
export async function refreshMicrosoftToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const connection = await getPlatformConnection(connectionId);

  if (!connection || !connection.decryptedRefreshToken) {
    throw new Error("Connection not found or no refresh token available");
  }

  try {
    const response = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID || "",
        client_secret: MICROSOFT_CLIENT_SECRET || "",
        refresh_token: connection.decryptedRefreshToken,
        grant_type: "refresh_token",
      }),
      {
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
      refreshToken: refresh_token || connection.decryptedRefreshToken,
      tokenExpiresAt: expiresAt,
    });

    return {
      accessToken: access_token,
      expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing Microsoft token:", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Failed to refresh access token");
  }
}
