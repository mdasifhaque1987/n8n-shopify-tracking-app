// OAuth callback handler for Google
import type { LoaderFunctionArgs } from "react-router";
import { exchangeGoogleCode } from "../../../services/oauth/google.server";
import { createPlatformConnection } from "../../../services/platform-connection.server";
import db from "../../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Check for OAuth errors
  if (error) {
    console.error("Google OAuth error:", error);
    return Response.redirect(
      `${url.origin}/app/connections?error=oauth_failed&platform=google`
    );
  }

  if (!code || !state) {
    return Response.json({ error: "Missing code or state" }, { status: 400 });
  }

  try {
    // Verify state to prevent CSRF
    const oauthState = await db.oAuthState.findUnique({
      where: { state },
    });

    if (!oauthState) {
      return Response.json({ error: "Invalid state parameter" }, { status: 400 });
    }

    // Check if state is expired
    if (oauthState.expiresAt < new Date()) {
      await db.oAuthState.delete({ where: { state } });
      return Response.json({ error: "State parameter expired" }, { status: 400 });
    }

    // Exchange code for tokens
    const tokenData = await exchangeGoogleCode(code);

    // Create platform connection
    await createPlatformConnection({
      workspaceId: oauthState.workspaceId,
      platform: "GOOGLE_ADS",
      accountId: tokenData.email,
      accountName: tokenData.email,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiresAt: tokenData.expiresAt,
      scopes: ["adwords", "analytics", "userinfo"],
    });

    // Clean up used state
    await db.oAuthState.delete({ where: { state } });

    // Redirect to success page
    return Response.redirect(
      `${url.origin}/app/connections?success=true&platform=google`
    );
  } catch (error) {
    console.error("Error in Google OAuth callback:", error);
    return Response.redirect(
      `${url.origin}/app/connections?error=oauth_failed&platform=google`
    );
  }
}
