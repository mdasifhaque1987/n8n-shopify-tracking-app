// OAuth callback handler for Google
import type { LoaderFunctionArgs } from "react-router";
import { exchangeGoogleCode } from "../services/oauth/google.server";
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
    console.error("Unable to decode OAuth state payload:", error instanceof Error ? error.name : "UnknownError");
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

  // Your current Shopify admin app handle is home-39.
  // Later, if Shopify changes it, add SHOPIFY_ADMIN_APP_HANDLE in .env.
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
    console.error(
      "Google OAuth error received from provider.",
    );
    return htmlPage(
      "Google connection failed",
      `Google returned error: ${error}`,
      "error",
      returnUrl
    );
  }

  if (!code || !state) {
    return htmlPage(
      "Google connection failed",
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
        "Google connection failed",
        "Invalid state parameter.",
        "error",
        returnUrl
      );
    }

    if (oauthState.expiresAt < new Date()) {
      await db.oAuthState.delete({ where: { state } });

      return htmlPage(
        "Google connection failed",
        "State parameter expired. Please try connecting again.",
        "error",
        returnUrl
      );
    }

    const tokenData = await exchangeGoogleCode(code);

    const connection = await createPlatformConnection({
      workspaceId: oauthState.workspaceId,
      platform: "GOOGLE_ADS",
      accountId: tokenData.email,
      accountName: tokenData.email,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiresAt: tokenData.expiresAt,
      scopes: [
        "https://www.googleapis.com/auth/adwords",
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/content",
        "https://www.googleapis.com/auth/datamanager",
      ],
    });

    await db.platformConnection.updateMany({
      where: {
        workspaceId: oauthState.workspaceId,
        platform: "GOOGLE_ADS",
        id: { not: connection.id },
      },
      data: { isActive: false },
    });

    /*
     * Google reconnect refreshes OAuth credentials only.
     *
     * Do NOT delete previously selected GA4, Google Ads,
     * Merchant Center, conversion, delivery, or server-side
     * configuration here.
     *
     * API discovery can temporarily fail because of quotas,
     * permissions, or Google service availability. OAuth
     * reauthentication must never destroy a valid merchant
     * configuration.
     */

    await db.oAuthState.delete({ where: { state } });

    /*
     * Every successful Google Connect/Reconnect gets one
     * explicit discovery request.
     *
     * The settings loader will:
     *   - start from the previous successful cache
     *   - refresh Google Ads once
     *   - refresh Merchant Center
     *   - refresh GA4
     *   - preserve cache when an API temporarily fails
     *
     * Ordinary settings-page reloads do not contain
     * loadGoogleAssets=true and therefore do not call the
     * Google discovery APIs.
     */
    const googleReturnUrl = (() => {
      try {
        const nextUrl =
          new URL(
            returnUrl,
            new URL(request.url).origin
          );

        nextUrl.searchParams.set(
          "unlockPlatform",
          "google"
        );

        nextUrl.searchParams.set(
          "loadGoogleAssets",
          "true"
        );

        const isAbsolute =
          /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(
            returnUrl
          );

        return isAbsolute
          ? nextUrl.toString()
          : `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      } catch {
        return returnUrl;
      }
    })();

    return htmlPage(
      "Google connected",
      "Google account connected successfully.",
      "success",
      googleReturnUrl
    );
  } catch (error) {
    console.error("Google OAuth callback failed", {
      category: "oauth_callback_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return htmlPage(
      "Google connection failed",
      "Google could not be connected. Please try again and grant all requested permissions.",
      "error",
      returnUrl
    );
  }
}
