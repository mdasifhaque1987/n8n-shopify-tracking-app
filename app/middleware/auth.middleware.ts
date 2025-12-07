// Authentication middleware for protecting routes
import type { Request, Response, NextFunction } from "express";
import { verifyToken, extractTokenFromHeader } from "../lib/auth.server";
import { verifyFirebaseToken } from "../lib/firebase.server";
import { getUserById, getOrCreateFirebaseUser } from "../services/user.server";
import type { User, UserRole } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

/**
 * Middleware to verify JWT token and attach user to request
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization || null;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Try JWT first
    try {
      const decoded = verifyToken(token);
      const user = await getUserById(decoded.userId);

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      req.user = user;
      req.userId = user.id;
      next();
    } catch (jwtError) {
      // If JWT fails, try Firebase token
      try {
        const firebaseToken = await verifyFirebaseToken(token);
        const user = await getOrCreateFirebaseUser(
          firebaseToken.uid,
          firebaseToken.email!,
          firebaseToken.name
        );

        req.user = user;
        req.userId = user.id;
        next();
      } catch (firebaseError) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication error" });
  }
}

/**
 * Middleware to check if user has required role
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

/**
 * Middleware to check if user is admin
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization || null;
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      try {
        const decoded = verifyToken(token);
        const user = await getUserById(decoded.userId);
        if (user) {
          req.user = user;
          req.userId = user.id;
        }
      } catch (error) {
        // Ignore token errors for optional auth
      }
    }

    next();
  } catch (error) {
    next();
  }
}
