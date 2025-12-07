// OAuth callback handler for Meta (Facebook)
import type { LoaderFunctionArgs } from "react-router";
import { exchangeMetaCode } from "../../../services/oauth/meta.server";
import { createPlatformConnection } from "../../../services/platform-connection.server";
import db from "../../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Check for OAuth errors
  if (error) {
    console.error("Meta OAuth error:", error);
    return Response.redirect(
      `${url.origin}/app/connections?error=oauth_failed&platform=meta`
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
    const tokenData = await exchangeMetaCode(code);

    // Create platform connection
    await createPlatformConnection({
      workspaceId: oauthState.workspaceId,
      platform: "META",
      accountId: tokenData.userId,
      accountName: tokenData.userId,
      accessToken: tokenData.accessToken,
      tokenExpiresAt: tokenData.expiresAt,
      scopes: ["ads_management", "business_management", "pages"],
    });

    // Clean up used state
    await db.oAuthState.delete({ where: { state } });

    // Redirect to success page
    return Response.redirect(
      `${url.origin}/app/connections?success=true&platform=meta`
    );
  } catch (error) {
    console.error("Error in Meta OAuth callback:", error);
    return Response.redirect(
      `${url.origin}/app/connections?error=oauth_failed&platform=meta`
    );
  }
}
