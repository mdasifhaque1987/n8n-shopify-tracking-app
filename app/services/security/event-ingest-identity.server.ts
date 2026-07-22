import { createHash, randomBytes } from "node:crypto";
import db from "../../db.server";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type EventIngestInstallation = {
  shop: string;
  workspaceId: string;
  installationId: number;
};

type ShopSettingsLookup = {
  findUnique(args: {
    where: { eventIngestKeyHash: string };
    select: { id: true; shop: true; workspaceId: true };
  }): Promise<{
    id: number;
    shop: string;
    workspaceId: string | null;
  } | null>;
};

export class EventIngestKeyError extends Error {
  status = 401;

  constructor() {
    super("Event ingestion key was not accepted.");
    this.name = "EventIngestKeyError";
  }
}

export class EventIngestShopMismatchError extends Error {
  status = 403;

  constructor() {
    super("Submitted shop does not match the installation selected by the ingestion key.");
    this.name = "EventIngestShopMismatchError";
  }
}

export function generateEventIngestKey(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashEventIngestKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function readBearerKey(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);

  if (!match || !TOKEN_PATTERN.test(match[1])) {
    throw new EventIngestKeyError();
  }

  return match[1];
}

export async function resolveEventIngestInstallation(
  request: Request,
  shopSettings: ShopSettingsLookup = db.shopSettings,
): Promise<EventIngestInstallation> {
  const keyHash = hashEventIngestKey(readBearerKey(request));
  const installation = await shopSettings.findUnique({
    where: { eventIngestKeyHash: keyHash },
    select: { id: true, shop: true, workspaceId: true },
  });

  if (!installation?.workspaceId) {
    throw new EventIngestKeyError();
  }

  return {
    shop: installation.shop,
    workspaceId: installation.workspaceId,
    installationId: installation.id,
  };
}

export function assertSubmittedShopMatches(
  submittedShop: string | null,
  canonicalShop: string,
): void {
  if (
    submittedShop &&
    submittedShop.trim().toLowerCase() !== canonicalShop.trim().toLowerCase()
  ) {
    throw new EventIngestShopMismatchError();
  }
}
