// LinkedIn OAuth service for Insight and Offline Conversions
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;

if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET || !LINKEDIN_REDIRECT_URI) {
  console.warn("LinkedIn OAuth credentials not configured");
}

const LINKEDIN_SCOPES = "r_ads,r_ads_reporting,rw_ads,r_organization_social";

/**
 * Generate LinkedIn OAuth authorization URL
 */
export function getLinkedInAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINKEDIN_CLIENT_ID || "",
    redirect_uri: LINKEDIN_REDIRECT_URI || "",
    state,
    scope: LINKEDIN_SCOPES,
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeLinkedInCode(code: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  try {
    const response = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: LINKEDIN_CLIENT_ID || "",
        client_secret: LINKEDIN_CLIENT_SECRET || "",
        redirect_uri: LINKEDIN_REDIRECT_URI || "",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    return {
      accessToken: access_token,
      expiresAt,
    };
  } catch (error) {
    console.error("Error exchanging LinkedIn code:", error);
    throw new Error("Failed to exchange authorization code");
  }
}

/**
 * Refresh LinkedIn access token
 * Note: LinkedIn requires re-authentication as tokens cannot be refreshed
 */
export async function refreshLinkedInToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  throw new Error("LinkedIn requires re-authentication. Please reconnect your account.");
}

/**
 * Get LinkedIn Ad Accounts
 */
export async function getLinkedInAdAccounts(accessToken: string): Promise<
  Array<{
    accountId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      "https://api.linkedin.com/v2/adAccountsV2?q=search",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.data.elements.map((account: { id: string; name: string }) => ({
      accountId: account.id,
      name: account.name,
    }));
  } catch (error) {
    console.error("Error getting LinkedIn ad accounts:", error);
    return [];
  }
}
