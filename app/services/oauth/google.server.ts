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
    const expiresAt = new Date(
      Date.now() + (tokens.expiry_date || Date.now() + 3600 * 1000)
    );

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      email: userInfo.data.email || "",
    };
  } catch (error) {
    console.error("Error exchanging Google code:", error);
    throw new Error("Failed to exchange authorization code");
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
export async function getGoogleAdsAccounts(): Promise<
  Array<{
    customerId: string;
    descriptiveName: string;
  }>
> {
  // Note: This requires Google Ads API which needs separate setup
  // For now, return empty array - will be implemented in full integration
  console.warn("Google Ads API integration pending");
  return [];
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
    console.error("Error getting Analytics properties:", error);
    return [];
  }
}
