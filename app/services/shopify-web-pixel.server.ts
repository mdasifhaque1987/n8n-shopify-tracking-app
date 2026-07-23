import db from "../db.server";
import {
  generateEventIngestKey,
  hashEventIngestKey,
} from "./security/event-ingest-identity.server";
import { decryptToken, encryptToken } from "../lib/encryption.server";
import { getAssetSelections } from "./asset-selection.server";
import { getGa4DeliverySettings } from "./ga4-delivery-settings.server";

type AdminGraphql = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

type PixelMutationResult = {
  userErrors?: Array<{
    field?: string[];
    message: string;
  }>;
  webPixel?: {
    id: string;
  } | null;
};

type PixelResult = {
  errors?: Array<{ message: string }>;
  data?: {
    webPixel?: { id: string } | null;
    webPixelCreate?: PixelMutationResult;
    webPixelUpdate?: PixelMutationResult;
    webPixelDelete?: {
      deletedWebPixelId?: string | null;
      userErrors?: Array<{
        field?: string[];
        message: string;
      }>;
    };
  };
};

function isMissingWebPixelError(error: unknown): boolean {
  const directMessage =
    error instanceof Error ? error.message.toLowerCase() : "";

  if (directMessage.includes("no web pixel was found for this app")) {
    return true;
  }

  const candidate = error as {
    body?: {
      errors?: {
        graphQLErrors?: Array<{ message?: unknown }>;
      };
    };
  };

  const graphqlErrors =
    candidate.body?.errors?.graphQLErrors || [];

  return graphqlErrors.some(
    (item) =>
      typeof item.message === "string" &&
      item.message
        .toLowerCase()
        .includes("no web pixel was found for this app"),
  );
}

async function getWebPixelId(
  admin: AdminGraphql,
): Promise<string | null> {
  try {
    const response = await admin.graphql(`
      #graphql
      query EventIngestWebPixel {
        webPixel {
          id
        }
      }
    `);

    const result = (await response.json()) as PixelResult;

    const missingPixel = result.errors?.some((error) =>
      error.message
        .toLowerCase()
        .includes("no web pixel was found for this app"),
    );

    if (missingPixel) {
      return null;
    }

    if (result.errors?.length) {
      throw new Error("Unable to read the Shopify web pixel.");
    }

    return result.data?.webPixel?.id || null;
  } catch (error) {
    if (isMissingWebPixelError(error)) {
      return null;
    }

    throw new Error("Unable to read the Shopify web pixel.");
  }
}

const INGESTION_ENDPOINT = "https://tracking.datahatches.com/api/events/track";

export async function buildPublicWebPixelSettings(input: {
  shop: string;
  ingestKey: string;
}) {
  const shopSettings = await db.shopSettings.findUnique({ where: { shop: input.shop }, select: { workspaceId: true, ga4Id: true, facebookPixelId: true } });
  let ga4MeasurementId = shopSettings?.ga4Id || "";
  let ga4Enabled = Boolean(ga4MeasurementId);
  let metaPixelId = shopSettings?.facebookPixelId || "";
  let metaEnabled = Boolean(metaPixelId);
  let metaEvents: string[] = [];
  let googleAdsConversions: Array<Record<string, unknown>> = [];
  let ga4DebugEnabled = false;
  let ga4ItemIdFormat =
    "shopify_country_product_variant";

  if (shopSettings?.workspaceId) {
    const [ga4, assets] = await Promise.all([
      getGa4DeliverySettings(
        shopSettings.workspaceId,
      ),
      getAssetSelections(
        shopSettings.workspaceId,
      ),
    ]);
    ga4MeasurementId = ga4.credential?.assetId || ga4MeasurementId;
    ga4Enabled = Boolean(
      ga4MeasurementId &&
      ga4.setting?.isActive &&
      ga4.setting
        ?.deliveryMode ===
        "client" &&
      ga4.setting
        ?.clientSideEnabled ===
        true
    );

    ga4DebugEnabled =
      ga4.setting?.testCode ===
      "debug_view";

    ga4ItemIdFormat =
      String(
        assets[
          "google:GA4 Property:item_id_format"
        ] ||
        "shopify_country_product_variant",
      ).trim() ||
      "shopify_country_product_variant";
    metaPixelId = String(assets["meta:Meta Dataset / Pixel"] || metaPixelId).trim();
    metaEnabled = Boolean(metaPixelId && String(assets["meta:Meta Client Side Enabled"] || "false") === "true");
    const rawEvents = String(assets["meta:Meta Selected Events"] || "");
    metaEvents = rawEvents === "none" ? [] : rawEvents.split(",").map((value) => value.trim()).filter(Boolean);
    googleAdsConversions = await db.googleAdsConversionAction.findMany({
      where: { workspaceId: shopSettings.workspaceId, isActive: true, deliveryMode: "client" },
      select: { eventName: true, conversionName: true, conversionId: true, conversionLabel: true, conversionActionId: true },
    });
  }

  return {
    shop_domain: input.shop,
    ingest_key: input.ingestKey,
    ingestion_endpoint: INGESTION_ENDPOINT,
    ga4_enabled: String(ga4Enabled),
    ga4_measurement_id: ga4MeasurementId,
    ga4_debug_enabled:
      String(
        ga4DebugEnabled,
      ),
    ga4_item_id_format:
      ga4ItemIdFormat,
    meta_enabled: String(metaEnabled),
    meta_pixel_id: metaPixelId,
    client_event_settings: JSON.stringify({ metaEvents, googleAdsConversions }),
  };
}

async function writeWebPixel(input: {
  admin: AdminGraphql;
  pixelId: string | null;
  settings: Record<string, string>;
}): Promise<string> {
  const webPixel = {
    settings: JSON.stringify(input.settings),
  };

  const response = input.pixelId
    ? await input.admin.graphql(
        `#graphql
        mutation SyncWebPixel(
          $id: ID!,
          $webPixel: WebPixelInput!
        ) {
          webPixelUpdate(
            id: $id,
            webPixel: $webPixel
          ) {
            userErrors {
              field
              message
            }
            webPixel {
              id
            }
          }
        }`,
        {
          variables: {
            id: input.pixelId,
            webPixel,
          },
        },
      )
    : await input.admin.graphql(
        `#graphql
        mutation SyncWebPixel(
          $webPixel: WebPixelInput!
        ) {
          webPixelCreate(
            webPixel: $webPixel
          ) {
            userErrors {
              field
              message
            }
            webPixel {
              id
            }
          }
        }`,
        {
          variables: {
            webPixel,
          },
        },
      );

  const result = (await response.json()) as PixelResult;

  const operation = input.pixelId
    ? result.data?.webPixelUpdate
    : result.data?.webPixelCreate;

  if (result.errors?.length || !operation) {
    throw new Error(
      "Shopify did not accept the web pixel settings.",
    );
  }

  if (operation.userErrors?.length) {
    throw new Error(
      operation.userErrors
        .map((error) => error.message)
        .join("; "),
    );
  }

  const writtenPixelId =
    operation.webPixel?.id || input.pixelId;

  if (!writtenPixelId) {
    throw new Error(
      "Shopify created the web pixel but did not return its ID.",
    );
  }

  return writtenPixelId;
}

export async function synchronizeWebPixelSettings(input: {
  shop: string;
  admin: AdminGraphql;
}) {
  const stored = await db.shopSettings.findUnique({
    where: {
      shop: input.shop,
    },
    select: {
      workspaceId: true,
      encryptedEventIngestKey: true,
      eventIngestKeyHash: true,
    },
  });

  if (!stored?.workspaceId) {
    throw new Error(
      "The shop workspace could not be found.",
    );
  }

  let ingestKey: string;
  let keyUpdate: {
    eventIngestKeyHash?: string;
    encryptedEventIngestKey?: string;
  } = {};

  if (stored.encryptedEventIngestKey) {
    ingestKey = decryptToken(
      stored.encryptedEventIngestKey,
    );

    if (!stored.eventIngestKeyHash) {
      keyUpdate.eventIngestKeyHash =
        hashEventIngestKey(ingestKey);
    }
  } else {
    ingestKey = generateEventIngestKey();

    keyUpdate = {
      eventIngestKeyHash:
        hashEventIngestKey(ingestKey),
      encryptedEventIngestKey:
        encryptToken(ingestKey),
    };
  }

  const existingPixelId =
    await getWebPixelId(input.admin);

  try {
    const settings =
      await buildPublicWebPixelSettings({
        shop: input.shop,
        ingestKey,
      });

    const writtenPixelId = await writeWebPixel({
      admin: input.admin,
      pixelId: existingPixelId,
      settings,
    });

    await db.shopSettings.update({
      where: {
        shop: input.shop,
      },
      data: {
        ...keyUpdate,
        webPixelId: writtenPixelId,
        webPixelSyncedAt: new Date(),
        webPixelSyncError: null,
      },
    });

    return {
      created: !existingPixelId,
      pixelId: writtenPixelId,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Web pixel synchronization failed.";

    await db.shopSettings.update({
      where: {
        shop: input.shop,
      },
      data: {
        webPixelSyncError: message,
      },
    });

    throw error;
  }
}

export async function getEventIngestPixelStatus(
  shop: string,
  admin: AdminGraphql,
) {
  const [pixelId, settings] = await Promise.all([
    getWebPixelId(admin),
    db.shopSettings.findUnique({
      where: { shop },
      select: { eventIngestKeyHash: true },
    }),
  ]);

  return {
    pixelExists: Boolean(pixelId),
    ingestKeyConfigured: Boolean(settings?.eventIngestKeyHash),
  };
}

export async function rotateEventIngestPixelCredential(input: {
  shop: string;
  workspaceId: string;
  admin: AdminGraphql;
}) {
  const ingestKey = generateEventIngestKey();
  const keyHash = hashEventIngestKey(ingestKey);

  const existingPixelId =
    await getWebPixelId(input.admin);

  const publicSettings =
    await buildPublicWebPixelSettings({
      shop: input.shop,
      ingestKey,
    });

  const writtenPixelId = await writeWebPixel({
    admin: input.admin,
    pixelId: existingPixelId,
    settings: publicSettings,
  });

  await db.shopSettings.upsert({
    where: {
      shop: input.shop,
    },
    create: {
      shop: input.shop,
      workspaceId: input.workspaceId,
      eventIngestKeyHash: keyHash,
      encryptedEventIngestKey:
        encryptToken(ingestKey),
      webPixelId: writtenPixelId,
      webPixelSyncedAt: new Date(),
      webPixelSyncError: null,
    },
    update: {
      workspaceId: input.workspaceId,
      eventIngestKeyHash: keyHash,
      encryptedEventIngestKey:
        encryptToken(ingestKey),
      webPixelId: writtenPixelId,
      webPixelSyncedAt: new Date(),
      webPixelSyncError: null,
    },
  });

  return {
    created: !existingPixelId,
    pixelId: writtenPixelId,
  };
}


export async function deactivateEventIngestPixel(input: {
  shop: string;
  admin: AdminGraphql;
}) {
  const pixelId = await getWebPixelId(input.admin);

  if (pixelId) {
    const response = await input.admin.graphql(
      `#graphql
      mutation DeactivateEventIngestWebPixel($id: ID!) {
        webPixelDelete(id: $id) {
          deletedWebPixelId
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          id: pixelId,
        },
      },
    );

    const result = (await response.json()) as PixelResult;
    const operation = result.data?.webPixelDelete;

    if (result.errors?.length || !operation) {
      throw new Error(
        "Shopify did not accept the web pixel deactivation.",
      );
    }

    if (operation.userErrors?.length) {
      throw new Error(
        operation.userErrors
          .map((error) => error.message)
          .join("; "),
      );
    }

    if (
      operation.deletedWebPixelId &&
      operation.deletedWebPixelId !== pixelId
    ) {
      throw new Error(
        "Shopify returned an unexpected deleted web pixel ID.",
      );
    }
  }

  await db.shopSettings.updateMany({
    where: {
      shop: input.shop,
    },
    data: {
      webPixelId: null,
      webPixelSyncedAt: null,
      webPixelSyncError: null,
      eventIngestKeyHash: null,
      encryptedEventIngestKey: null,
    },
  });

  return {
    deleted: Boolean(pixelId),
  };
}
