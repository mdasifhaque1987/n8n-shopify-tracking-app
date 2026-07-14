import type { PlatformConnection } from "@prisma/client";
import db from "../db.server";

type EncryptionHelpers = {
  encrypt?: (value: string) => string | Promise<string>;
  decrypt?: (value: string) => string | Promise<string>;
};

type GoogleTokenConnection = Pick<
  PlatformConnection,
  "id" | "accessToken" | "refreshToken" | "tokenExpiresAt"
>;

async function loadEncryptionHelpers(): Promise<EncryptionHelpers> {
  try {
    const mod: Record<string, unknown> = await import("../lib/encryption.server");

    const encryptNames = [
      "encrypt",
      "encryptValue",
      "encryptSecret",
      "encryptString",
      "encryptToken",
    ];

    const decryptNames = [
      "decrypt",
      "decryptValue",
      "decryptSecret",
      "decryptString",
      "decryptToken",
    ];

    const encrypt = encryptNames
      .map((name) => mod[name])
      .find((fn) => typeof fn === "function") as EncryptionHelpers["encrypt"];

    const decrypt = decryptNames
      .map((name) => mod[name])
      .find((fn) => typeof fn === "function") as EncryptionHelpers["decrypt"];

    return { encrypt, decrypt };
  } catch (error) {
    console.warn("[Google Token] Could not load encryption helpers", error);
    return {};
  }
}

function looksEncrypted(value?: string | null) {
  if (!value) return false;
  return value.startsWith("U2FsdGVk") || value.startsWith("enc:");
}

function looksLikeGoogleAccessToken(value?: string | null) {
  return Boolean(value && value.startsWith("ya29."));
}

async function maybeDecrypt(value: string | null | undefined) {
  if (!value) return null;

  if (!looksEncrypted(value)) {
    return value;
  }

  const helpers = await loadEncryptionHelpers();

  if (!helpers.decrypt) {
    throw new Error("Encrypted Google token found, but no decrypt helper was exported from app/lib/encryption.server.ts");
  }

  const decrypted = await helpers.decrypt(value);

  if (!decrypted) {
    throw new Error("Could not decrypt Google token");
  }

  return String(decrypted);
}

async function maybeEncrypt(value: string, shouldEncrypt: boolean) {
  if (!shouldEncrypt) return value;

  const helpers = await loadEncryptionHelpers();

  if (!helpers.encrypt) {
    return value;
  }

  return String(await helpers.encrypt(value));
}

function getGoogleOAuthClientId() {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_ADS_CLIENT_ID ||
    ""
  );
}

function getGoogleOAuthClientSecret() {
  return (
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_ADS_CLIENT_SECRET ||
    ""
  );
}

function tokenNeedsRefresh(
  connection: GoogleTokenConnection,
  accessToken: string | null,
  forceRefresh = false
) {
  if (forceRefresh) {
    return true;
  }

  if (!accessToken || !looksLikeGoogleAccessToken(accessToken)) {
    return true;
  }

  if (!connection?.tokenExpiresAt) {
    return false;
  }

  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

  return expiresAt <= fiveMinutesFromNow;
}

export async function resolveGoogleAccessToken(
  connection: GoogleTokenConnection,
  options: { forceRefresh?: boolean } = {}
) {
  const accessTokenWasEncrypted = looksEncrypted(connection?.accessToken);
  const refreshTokenWasEncrypted = looksEncrypted(connection?.refreshToken);

  let accessToken = await maybeDecrypt(connection?.accessToken);
  const refreshToken = await maybeDecrypt(connection?.refreshToken);

  if (
    !tokenNeedsRefresh(
      connection,
      accessToken,
      Boolean(options.forceRefresh)
    )
  ) {
    return accessToken as string;
  }

  if (!refreshToken) {
    throw new Error("Google refresh token is missing. Please reconnect Google.");
  }

  const clientId = getGoogleOAuthClientId();
  const clientSecret = getGoogleOAuthClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client ID/client secret is missing in .env");
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(
      data?.error_description ||
        data?.error ||
        `Google token refresh failed with status ${response.status}`
    );
  }

  accessToken = String(data.access_token);

  await db.platformConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      accessToken: await maybeEncrypt(accessToken, accessTokenWasEncrypted),
      refreshToken: data.refresh_token
        ? await maybeEncrypt(String(data.refresh_token), refreshTokenWasEncrypted)
        : connection.refreshToken,
      tokenExpiresAt: data.expires_in
        ? new Date(Date.now() + Number(data.expires_in) * 1000)
        : connection.tokenExpiresAt,
    },
  });

  return accessToken;
}

function getGoogleApiStatus(error: unknown): number {
  if (!error || typeof error !== "object") {
    return 0;
  }

  const candidate = error as {
    status?: number | string;
    code?: number | string;
    response?: {
      status?: number | string;
    };
  };

  const rawStatus =
    candidate.response?.status ??
    candidate.status ??
    candidate.code ??
    0;

  const status = Number(rawStatus);

  return Number.isFinite(status) ? status : 0;
}

export async function withGoogleAccessTokenRetry<T>(
  connection: GoogleTokenConnection,
  operation: (accessToken: string) => Promise<T>
): Promise<T> {
  const latestConnection = connection?.id
    ? await db.platformConnection.findUnique({
        where: {
          id: connection.id,
        },
      })
    : connection;

  if (!latestConnection) {
    throw new Error("Google connection was not found.");
  }

  let accessToken =
    await resolveGoogleAccessToken(latestConnection);

  try {
    return await operation(accessToken);
  } catch (error) {
    if (getGoogleApiStatus(error) !== 401) {
      throw error;
    }

    console.warn(
      "[Google Token] Access token was rejected with 401. Refreshing and retrying once."
    );

    const currentConnection = latestConnection.id
      ? await db.platformConnection.findUnique({
          where: {
            id: latestConnection.id,
          },
        })
      : latestConnection;

    accessToken = await resolveGoogleAccessToken(
      currentConnection || latestConnection,
      {
        forceRefresh: true,
      }
    );

    return operation(accessToken);
  }
}
