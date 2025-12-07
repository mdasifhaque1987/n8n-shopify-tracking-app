// API route for user registration
import type { ActionFunctionArgs } from "react-router";
import { createUser } from "../../../services/user.server";
import { createWorkspace } from "../../../services/workspace.server";
import { isValidEmail, isValidPassword, generateToken } from "../../../lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { email, password, name } = body;

    // Validate input
    if (!email || !password) {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return Response.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (!isValidPassword(password)) {
      return Response.json(
        {
          error:
            "Password must be at least 8 characters and contain letters and numbers",
        },
        { status: 400 }
      );
    }

    // Create user
    const user = await createUser({
      email,
      password,
      name,
    });

    // Create default workspace
    const slug = `${email.split("@")[0].replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const workspace = await createWorkspace({
      name: `${name || email}'s Workspace`,
      slug,
      ownerId: user.id,
    });

    // Generate token
    const token = generateToken(user);

    return Response.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Registration failed" },
      { status: 400 }
    );
  }
}
