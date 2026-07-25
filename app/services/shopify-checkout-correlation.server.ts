import { createHash } from "node:crypto";
import db from "../db.server";
import {
  decryptToken,
  encryptToken,
} from "../lib/encryption.server";
import {
  isDhUniqueEventId,
} from "../lib/utils/dh-event-id";
import type {
  NormalizedTrackingEvent,
} from "./normalize-event.server";

const CORRELATION_TTL_MS =
  7 * 24 * 60 * 60 * 1000;

const CHECKOUT_EVENTS = new Set([
  "begin_checkout",
  "add_contact_info",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
]);

export type ShopifyCheckoutIdentity = {
  clientId: string;
  sessionId: string | null;
  purchaseEventId: string | null;
  capturedAt: number;
};

function record(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return value === undefined ||
    value === null
    ? ""
    : String(value).trim();
}

function normalizeShop(shop: string): string {
  return text(shop).toLowerCase();
}

function normalizeCheckoutToken(
  value: unknown,
): string {
  const token = text(value);

  if (
    !token ||
    token.length > 512
  ) {
    return "";
  }

  return token;
}

function hashCheckoutToken(
  token: string,
): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

function isGaStyleClientId(
  value: string,
): boolean {
  return /^\d+\.\d+$/.test(value);
}

function parseStoredIdentity(
  encryptedPayload: string,
): ShopifyCheckoutIdentity | null {
  try {
    const parsed = record(
      JSON.parse(
        decryptToken(encryptedPayload),
      ),
    );

    const clientId =
      text(parsed.clientId);

    if (!isGaStyleClientId(clientId)) {
      return null;
    }

    const purchaseEventId =
      text(
        parsed.purchaseEventId ||
        parsed.purchase_event_id,
      );

    return {
      clientId,
      sessionId:
        text(parsed.sessionId) ||
        null,
      purchaseEventId:
        isDhUniqueEventId(
          purchaseEventId
        )
          ? purchaseEventId
          : null,
      capturedAt:
        Number(parsed.capturedAt) ||
        Date.now(),
    };
  } catch {
    return null;
  }
}

export async function persistShopifyCheckoutCorrelation(
  input: {
    shop: string;
    event: NormalizedTrackingEvent;
  },
): Promise<boolean> {
  if (
    !CHECKOUT_EVENTS.has(
      input.event.event_name,
    )
  ) {
    return false;
  }

  const raw = record(
    input.event.raw,
  );

  const checkoutToken =
    normalizeCheckoutToken(
      raw.checkout_token ||
      raw.checkoutToken ||
      raw.checkout_id ||
      raw.checkoutId,
    );

  const clientId = text(
    raw.client_id ||
    raw.clientId ||
    raw.ga_client_id ||
    raw.gaClientId ||
    input.event.client_id,
  );

  const sessionId = text(
    raw.session_id ||
    raw.sessionId ||
    raw.ga_session_id ||
    raw.gaSessionId,
  );

  const purchaseEventIdCandidate =
    text(
      raw.purchase_event_id ||
      raw.purchaseEventId ||
      (
        input.event.event_name ===
        "purchase"
          ? input.event.event_id
          : ""
      ),
    );

  const purchaseEventId =
    isDhUniqueEventId(
      purchaseEventIdCandidate
    )
      ? purchaseEventIdCandidate
      : null;

  const shop =
    normalizeShop(input.shop);

  if (
    !shop ||
    !checkoutToken ||
    !isGaStyleClientId(clientId)
  ) {
    return false;
  }

  const now = new Date();

  const identity: ShopifyCheckoutIdentity = {
    clientId,
    sessionId:
      sessionId || null,
    purchaseEventId,
    capturedAt: Date.now(),
  };

  try {
    await db.$transaction([
      db.shopifyCheckoutCorrelation.upsert({
        where: {
          shop_checkoutTokenHash: {
            shop,
            checkoutTokenHash:
              hashCheckoutToken(
                checkoutToken,
              ),
          },
        },
        update: {
          encryptedPayload:
            encryptToken(
              JSON.stringify(identity),
            ),
          expiresAt: new Date(
            Date.now() +
            CORRELATION_TTL_MS,
          ),
        },
        create: {
          shop,
          checkoutTokenHash:
            hashCheckoutToken(
              checkoutToken,
            ),
          encryptedPayload:
            encryptToken(
              JSON.stringify(identity),
            ),
          expiresAt: new Date(
            Date.now() +
            CORRELATION_TTL_MS,
          ),
        },
      }),

      db.shopifyCheckoutCorrelation.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      }),
    ]);

    return true;
  } catch (error) {
    console.warn(
      "[Shopify checkout correlation] Persist failed",
      error instanceof Error
        ? error.name
        : "UnknownError",
    );

    return false;
  }
}

export async function getShopifyCheckoutIdentity(
  shopValue: string,
  checkoutTokenValue: unknown,
): Promise<ShopifyCheckoutIdentity | null> {
  const shop =
    normalizeShop(shopValue);

  const checkoutToken =
    normalizeCheckoutToken(
      checkoutTokenValue,
    );

  if (!shop || !checkoutToken) {
    return null;
  }

  const row =
    await db.shopifyCheckoutCorrelation.findUnique({
      where: {
        shop_checkoutTokenHash: {
          shop,
          checkoutTokenHash:
            hashCheckoutToken(
              checkoutToken,
            ),
        },
      },
      select: {
        encryptedPayload: true,
        expiresAt: true,
      },
    });

  if (
    !row ||
    row.expiresAt.getTime() <
      Date.now()
  ) {
    return null;
  }

  return parseStoredIdentity(
    row.encryptedPayload,
  );
}
