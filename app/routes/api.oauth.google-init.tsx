import type { LoaderFunctionArgs } from "react-router";
import { generateSecureState } from "../lib/encryption.server";
import { getGoogleAuthUrl } from "../services/oauth/google.server";
import db from "../db.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import { authenticate } from "../shopify.server";

function normalizeShop(shop: string) {
  return shop
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function encodeStatePayload(payload: {
  nonce: string;
  shop: string;
  returnPath: string;
}) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  let shop =
    url.searchParams.get("shop") ||
    url.searchParams.get("workspaceId") ||
    "";

  if (!shop) {
    try {
      const { session } = await authenticate.admin(request);
      shop = session.shop;
    } catch (error) {
      console.error("Unable to resolve Shopify session for Google OAuth:", error instanceof Error ? error.name : "UnknownError");
    }
  }

  if (!shop) {
    return Response.json(
      { error: "shop is required" },
      { status: 400 }
    );
  }

  shop = normalizeShop(shop);

  const returnPath =
    url.searchParams.get("returnPath") ||
    "/app/settings?unlockPlatform=google&loadGoogleAssets=true";

  const workspace = await getOrCreateShopWorkspace(shop);

  const nonce = generateSecureState();

  const state = encodeStatePayload({
    nonce,
    shop,
    returnPath,
  });

  await db.oAuthState.create({
    data: {
      state,
      workspaceId: workspace.id,
      platform: "GOOGLE_ADS",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const authUrl = getGoogleAuthUrl(state);

  return Response.redirect(authUrl);
}
