// OAuth initialization route for Google
import type { LoaderFunctionArgs } from "react-router";
import { generateSecureState } from "../../../lib/encryption.server";
import { getGoogleAuthUrl } from "../../../services/oauth/google.server";
import db from "../../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");

  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Generate secure state parameter
  const state = generateSecureState();

  // Store state in database for verification (expires in 10 minutes)
  await db.oAuthState.create({
    data: {
      state,
      workspaceId,
      platform: "GOOGLE_ADS",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  // Get authorization URL
  const authUrl = getGoogleAuthUrl(state);

  return Response.redirect(authUrl);
}
