// OAuth callback handler for Meta / Facebook
import type { LoaderFunctionArgs } from "react-router";
import { exchangeMetaCode } from "../services/oauth/meta.server";
import { createPlatformConnection } from "../services/platform-connection.server";
import db from "../db.server";

function decodeStatePayload(state: string): {
  nonce?: string;
  shop?: string;
  returnPath?: string;
} {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("Unable to decode Meta OAuth state payload:", error);
    return {};
  }
}

function getShopifyStoreHandle(shop: string) {
  return shop
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/i, "")
    .trim()
    .toLowerCase();
}

function safeReturnPath(path?: string) {
  if (!path) return "/app/settings";

  // Prevent external redirects.
  if (!path.startsWith("/")) return "/app/settings";
  if (path.startsWith("//")) return "/app/settings";
  if (path.includes("://")) return "/app/settings";

  return path;
}

function buildShopifyAdminReturnUrl(shop?: string, returnPath?: string) {
  if (!shop) {
    return process.env.SHOPIFY_ADMIN_APP_RETURN_URL || "";
  }

  const storeHandle = getShopifyStoreHandle(shop);
  const appHandle = process.env.SHOPIFY_ADMIN_APP_HANDLE || "home-39";
  const path = safeReturnPath(returnPath);

  return `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}${path}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlPage(
  title: string,
  message: string,
  type: "success" | "error" = "success",
  returnUrl = ""
) {
  const isSuccess = type === "success";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeReturnUrl = returnUrl ? JSON.stringify(returnUrl) : "";

  const redirectScript =
    isSuccess && returnUrl
      ? `<script>setTimeout(function(){ window.location.href = ${safeReturnUrl}; }, 1500);</script>`
      : "";

  const returnButton =
    isSuccess && returnUrl
      ? `<a class="button" href="${escapeHtml(returnUrl)}">Back to Shopify App</a>`
      : `<button onclick="window.close()">Close tab</button>`;

  const color = type === "success" ? "#166534" : "#991b1b";
  const bg = type === "success" ? "#ecfdf5" : "#fef2f2";

  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f6f7; padding: 40px; }
      .card { max-width: 620px; margin: 80px auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
      .notice { background: ${bg}; color: ${color}; padding: 16px; border-radius: 12px; font-weight: 700; }
      p { color: #4b5563; line-height: 1.6; }
      button, .button { background: #2563eb; color: white; border: 0; border-radius: 10px; padding: 12px 18px; cursor: pointer; font-weight: 700; text-decoration: none; display: inline-block; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <div class="notice">${safeMessage}</div>
      <p>${type === "success" ? "Redirecting you back to the Shopify app..." : "You can now close this tab and return to the Shopify app."}</p>
      ${returnButton}
      ${redirectScript}
    </div>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const statePayload = state ? decodeStatePayload(state) : {};
  const returnUrl = buildShopifyAdminReturnUrl(
    statePayload.shop,
    statePayload.returnPath
  );

  if (error) {
    console.error("Meta OAuth error:", error);

    return htmlPage(
      "Meta connection failed",
      `Meta returned error: ${error}`,
      "error",
      returnUrl
    );
  }

  if (!code || !state) {
    return htmlPage(
      "Meta connection failed",
      "Missing code or state.",
      "error",
      returnUrl
    );
  }

  try {
    const oauthState = await db.oAuthState.findUnique({
      where: { state },
    });

    if (!oauthState) {
      return htmlPage(
        "Meta connection failed",
        "Invalid state parameter.",
        "error",
        returnUrl
      );
    }

    if (oauthState.expiresAt < new Date()) {
      await db.oAuthState.delete({ where: { state } });

      return htmlPage(
        "Meta connection failed",
        "State parameter expired. Please try connecting again.",
        "error",
        returnUrl
      );
    }

    const tokenData = await exchangeMetaCode(code);

    await createPlatformConnection({
      workspaceId: oauthState.workspaceId,
      platform: "META",
      accountId: tokenData.userId,
      accountName: tokenData.userName || tokenData.userId,
      accessToken: tokenData.accessToken,
      tokenExpiresAt: tokenData.expiresAt,
      scopes: [
        "ads_management",
        "ads_read",
        "business_management",
                        ],
    });

    await db.oAuthState.delete({ where: { state } });

    return htmlPage(
      "Meta connected",
      "Meta account connected successfully.",
      "success",
      returnUrl
    );
  } catch (error) {
    console.error("Error in Meta OAuth callback:", error);

    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error);

    return htmlPage(
      "Meta connection failed",
      `Debug error: ${message}`,
      "error",
      returnUrl
    );
  }
}
