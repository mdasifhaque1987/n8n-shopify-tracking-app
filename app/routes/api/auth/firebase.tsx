// API route for Firebase authentication
import type { ActionFunctionArgs } from "react-router";
import { verifyFirebaseToken } from "../../../lib/firebase.server";
import { getOrCreateFirebaseUser } from "../../../services/user.server";
import { getUserWorkspaces, createWorkspace } from "../../../services/workspace.server";
import { generateToken } from "../../../lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { idToken } = body;

    if (!idToken) {
      return Response.json({ error: "Firebase ID token is required" }, { status: 400 });
    }

    // Verify Firebase token
    const firebaseToken = await verifyFirebaseToken(idToken);

    // Get or create user
    const user = await getOrCreateFirebaseUser(
      firebaseToken.uid,
      firebaseToken.email!,
      firebaseToken.name
    );

    // Get user's workspaces
    let workspaces = await getUserWorkspaces(user.id);

    // Create default workspace if user is new
    if (workspaces.length === 0) {
      const slug = firebaseToken.email!
        .split("@")[0]
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase();
      const workspace = await createWorkspace({
        name: `${firebaseToken.name || firebaseToken.email}'s Workspace`,
        slug: `${slug}-${Date.now()}`,
        ownerId: user.id,
      });
      workspaces = [workspace];
    }

    // Generate JWT token for our API
    const token = generateToken(user);

    return Response.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      workspaces: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
      })),
      token,
    });
  } catch (error) {
    console.error("Firebase auth error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Firebase authentication failed" },
      { status: 401 }
    );
  }
}
