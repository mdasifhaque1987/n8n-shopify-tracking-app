// TikTok OAuth service for Pixel and Events API
import axios from "axios";
import {
  updateConnectionTokens,
  getPlatformConnection,
} from "../platform-connection.server";

const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID;
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

if (!TIKTOK_APP_ID || !TIKTOK_APP_SECRET || !TIKTOK_REDIRECT_URI) {
  console.warn("TikTok OAuth credentials not configured");
}

/**
 * Generate TikTok OAuth authorization URL
 */
export function getTikTokAuthUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: TIKTOK_APP_ID || "",
    redirect_uri: TIKTOK_REDIRECT_URI || "",
    state,
    scope: "user.info.basic,video.list,ads.campaign.get,pixel.get",
  });

  return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeTikTokCode(code: string): Promise<{
  accessToken: string;
  expiresAt: Date;
  advertiserIds: string[];
}> {
  try {
    const response = await axios.post(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
      {
        app_id: TIKTOK_APP_ID,
        secret: TIKTOK_APP_SECRET,
        auth_code: code,
      }
    );

    const { access_token, expires_in, advertiser_ids } = response.data.data;

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    return {
      accessToken: access_token,
      expiresAt,
      advertiserIds: advertiser_ids || [],
    };
  } catch (error) {
    console.error("Error exchanging TikTok code:", error instanceof Error ? error.name : "UnknownError");
    throw new Error("Failed to exchange authorization code");
  }
}

/**
 * Refresh TikTok access token
 * Note: TikTok doesn't provide refresh tokens, need to re-authenticate
 */
export async function refreshTikTokToken(
  connectionId: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  // TikTok tokens cannot be refreshed - user must re-authenticate
  throw new Error("TikTok requires re-authentication. Please reconnect your account.");
}

/**
 * Get TikTok advertiser accounts
 */
export async function getTikTokAdvertisers(accessToken: string): Promise<
  Array<{
    advertiserId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/",
      {
        params: {
          access_token: accessToken,
        },
      }
    );

    return response.data.data.list.map((advertiser: { advertiser_id: string; advertiser_name: string }) => ({
      advertiserId: advertiser.advertiser_id,
      name: advertiser.advertiser_name,
    }));
  } catch (error) {
    console.error("Error getting TikTok advertisers:", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}

/**
 * Get TikTok pixels for an advertiser
 */
export async function getTikTokPixels(
  accessToken: string,
  advertiserId: string
): Promise<
  Array<{
    pixelId: string;
    name: string;
  }>
> {
  try {
    const response = await axios.get(
      "https://business-api.tiktok.com/open_api/v1.3/pixel/list/",
      {
        params: {
          access_token: accessToken,
          advertiser_id: advertiserId,
        },
      }
    );

    return response.data.data.pixels.map((pixel: { pixel_id: string; pixel_name: string }) => ({
      pixelId: pixel.pixel_id,
      name: pixel.pixel_name,
    }));
  } catch (error) {
    console.error("Error getting TikTok pixels:", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}
