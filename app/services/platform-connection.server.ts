// Platform connection service for managing OAuth tokens and connections
import db from "../db.server";
import { encryptToken, decryptToken } from "../lib/encryption.server";
import type { Platform, PlatformConnection } from "@prisma/client";

export interface CreateConnectionData {
  workspaceId: string;
  platform: Platform;
  accountId: string;
  accountName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
}

export interface UpdateTokenData {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

/**
 * Create a new platform connection with encrypted tokens
 */
export async function createPlatformConnection(
  data: CreateConnectionData
): Promise<PlatformConnection> {
  // Encrypt sensitive tokens before storing
  const encryptedAccessToken = encryptToken(data.accessToken);
  const encryptedRefreshToken = data.refreshToken
    ? encryptToken(data.refreshToken)
    : null;

  const existing = await db.platformConnection.findUnique({
    where: {
      workspaceId_platform_accountId: {
        workspaceId: data.workspaceId,
        platform: data.platform,
        accountId: data.accountId,
      },
    },
  });

  if (existing) {
    return db.platformConnection.update({
      where: { id: existing.id },
      data: {
        accountName: data.accountName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken || existing.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
        isActive: true,
      },
    });
  }

  return db.platformConnection.create({
    data: {
      workspaceId: data.workspaceId,
      platform: data.platform,
      accountId: data.accountId,
      accountName: data.accountName,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
      scopes: data.scopes,
      isActive: true,
    },
  });
}

/**
 * Get platform connection by ID with decrypted tokens
 */
export async function getPlatformConnection(
  id: string
): Promise<(PlatformConnection & { decryptedAccessToken: string; decryptedRefreshToken?: string }) | null> {
  const connection = await db.platformConnection.findUnique({
    where: { id },
  });

  if (!connection) {
    return null;
  }

  return {
    ...connection,
    decryptedAccessToken: decryptToken(connection.accessToken),
    decryptedRefreshToken: connection.refreshToken
      ? decryptToken(connection.refreshToken)
      : undefined,
  };
}

/**
 * Get all connections for a workspace
 */
export async function getWorkspaceConnections(
  workspaceId: string,
  platform?: Platform
): Promise<PlatformConnection[]> {
  const where: { workspaceId: string; platform?: Platform } = { workspaceId };
  if (platform) {
    where.platform = platform;
  }

  return db.platformConnection.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Update platform connection tokens
 */
export async function updateConnectionTokens(
  id: string,
  data: UpdateTokenData
): Promise<PlatformConnection> {
  const encryptedAccessToken = encryptToken(data.accessToken);
  const encryptedRefreshToken = data.refreshToken
    ? encryptToken(data.refreshToken)
    : undefined;

  return db.platformConnection.update({
    where: { id },
    data: {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
    },
  });
}

/**
 * Check if token is expiring soon (within 5 minutes)
 */
export function isTokenExpiringSoon(tokenExpiresAt: Date | null): boolean {
  if (!tokenExpiresAt) return false;
  
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  return tokenExpiresAt <= fiveMinutesFromNow;
}

/**
 * Deactivate a platform connection
 */
export async function deactivateConnection(id: string): Promise<void> {
  await db.platformConnection.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * Reactivate a platform connection
 */
export async function reactivateConnection(id: string): Promise<void> {
  await db.platformConnection.update({
    where: { id },
    data: { isActive: true },
  });
}

/**
 * Delete a platform connection
 */
export async function deleteConnection(id: string): Promise<void> {
  await db.platformConnection.delete({
    where: { id },
  });
}

/**
 * Get connection by workspace and platform account
 */
export async function getConnectionByAccount(
  workspaceId: string,
  platform: Platform,
  accountId: string
): Promise<PlatformConnection | null> {
  return db.platformConnection.findUnique({
    where: {
      workspaceId_platform_accountId: {
        workspaceId,
        platform,
        accountId,
      },
    },
  });
}


export async function getGooglePlatformConnection(workspaceId: string) {
  const isGooglePlatform = (platform: unknown) => {
    const value = String(platform || "").toUpperCase();
    return value === "GOOGLE" || value === "GOOGLE_ADS";
  };

  const workspaceConnections = await db.platformConnection.findMany({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const workspaceGoogleConnection = workspaceConnections.find(
    (connection: (typeof workspaceConnections)[number]) =>
    isGooglePlatform(connection.platform)
  );

  if (workspaceGoogleConnection) {
    return workspaceGoogleConnection;
  }

  const activeConnections = await db.platformConnection.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    activeConnections.find(
      (connection: (typeof activeConnections)[number]) =>
        isGooglePlatform(connection.platform)
    ) || null
  );
}
