// OAuth callback handler for Google
import type { LoaderFunctionArgs } from "react-router";
import { exchangeGoogleCode } from "../services/oauth/google.server";
import { createPlatformConnection } from "../services/platform-connection.server";
import db from "../db.server";

function htmlPage(title: string, message: string, type: "success" | "error" = "success") {
  const returnUrl = process.env.SHOPIFY_ADMIN_APP_RETURN_URL || "";
  const isSuccess = type === "success";
  const redirectScript =
    isSuccess && returnUrl
      ? `<script>setTimeout(function(){ window.location.href = "${returnUrl}"; }, 1500);</script>`
      : "";
  const returnButton =
    isSuccess && returnUrl
      ? `<a class="button" href="${returnUrl}">Back to Shopify App</a>`
      : `<button onclick="window.close()">Close tab</button>`;
  const color = type === "success" ? "#166534" : "#991b1b";
  const bg = type === "success" ? "#ecfdf5" : "#fef2f2";

  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
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
      <h1>${title}</h1>
      <div class="notice">${message}</div>
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

  if (error) {
    console.error("Google OAuth error:", error);
    return htmlPage("Google connection failed", `Google returned error: ${error}`, "error");
  }

  if (!code || !state) {
    return htmlPage("Google connection failed", "Missing code or state.", "error");
  }

  try {
    const oauthState = await db.oAuthState.findUnique({
      where: { state },
    });

    if (!oauthState) {
      return htmlPage("Google connection failed", "Invalid state parameter.", "error");
    }

    if (oauthState.expiresAt < new Date()) {
      await db.oAuthState.delete({ where: { state } });
      return htmlPage("Google connection failed", "State parameter expired. Please try connecting again.", "error");
    }

    const tokenData = await exchangeGoogleCode(code);

    await createPlatformConnection({
      workspaceId: oauthState.workspaceId,
      platform: "GOOGLE_ADS",
      accountId: tokenData.email,
      accountName: tokenData.email,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiresAt: tokenData.expiresAt,
      scopes: ["adwords", "analytics", "userinfo", "content"],
    });

    await db.oAuthState.delete({ where: { state } });

    return htmlPage("Google connected", "Google account connected successfully.");
  } catch (error) {
    console.error("Error in Google OAuth callback:", error);

    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error);

    return htmlPage(
      "Google connection failed",
      `Debug error: ${message}`,
      "error"
    );
  }
}
