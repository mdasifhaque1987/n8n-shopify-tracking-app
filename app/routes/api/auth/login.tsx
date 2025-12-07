// API route for user login
import type { ActionFunctionArgs } from "react-router";
import { loginUser } from "../../../services/user.server";
import { getUserWorkspaces } from "../../../services/workspace.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Login user
    const { user, token } = await loginUser({ email, password });

    // Get user's workspaces
    const workspaces = await getUserWorkspaces(user.id);

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
    console.error("Login error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 401 }
    );
  }
}
