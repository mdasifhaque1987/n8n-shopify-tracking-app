// User service for managing user accounts and authentication
import db from "../db.server";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth.server";
import type { User, UserRole } from "@prisma/client";

export interface CreateUserData {
  email: string;
  password?: string;
  name?: string;
  firebaseUid?: string;
  role?: UserRole;
}

export interface LoginData {
  email: string;
  password: string;
}

/**
 * Create a new user with email/password
 */
export async function createUser(data: CreateUserData): Promise<User> {
  // Check if user already exists
  const existing = await db.user.findUnique({
    where: { email: data.email },
  });

  if (existing) {
    throw new Error("User with this email already exists");
  }

  // Hash password if provided
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  // Create user
  const user = await db.user.create({
    data: {
      email: data.email,
      passwordHash,
      name: data.name,
      firebaseUid: data.firebaseUid,
      role: data.role || "USER",
      emailVerified: !!data.firebaseUid, // Auto-verify if from Firebase
    },
  });

  return user;
}

/**
 * Login user with email/password
 */
export async function loginUser(data: LoginData): Promise<{ user: User; token: string }> {
  // Find user
  const user = await db.user.findUnique({
    where: { email: data.email },
  });

  if (!user || !user.passwordHash) {
    throw new Error("Invalid email or password");
  }

  // Verify password
  const isValid = await verifyPassword(data.password, user.passwordHash);
  if (!isValid) {
    throw new Error("Invalid email or password");
  }

  // Generate JWT token
  const token = generateToken(user);

  return { user, token };
}

/**
 * Get or create user from Firebase authentication
 */
export async function getOrCreateFirebaseUser(
  firebaseUid: string,
  email: string,
  name?: string
): Promise<User> {
  // Try to find existing user by Firebase UID
  let user = await db.user.findUnique({
    where: { firebaseUid },
  });

  if (user) {
    return user;
  }

  // Try to find by email
  user = await db.user.findUnique({
    where: { email },
  });

  if (user) {
    // Link Firebase UID to existing account
    user = await db.user.update({
      where: { id: user.id },
      data: {
        firebaseUid,
        emailVerified: true,
      },
    });
    return user;
  }

  // Create new user
  user = await createUser({
    email,
    name,
    firebaseUid,
  });

  return user;
}

/**
 * Get user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  return db.user.findUnique({
    where: { id },
  });
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  return db.user.findUnique({
    where: { email },
  });
}

/**
 * Update user
 */
export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  return db.user.update({
    where: { id },
    data,
  });
}

/**
 * Delete user
 */
export async function deleteUser(id: string): Promise<void> {
  await db.user.delete({
    where: { id },
  });
}

/**
 * List all users (admin only)
 */
export async function listUsers(): Promise<User[]> {
  return db.user.findMany({
    orderBy: { createdAt: "desc" },
  });
}
