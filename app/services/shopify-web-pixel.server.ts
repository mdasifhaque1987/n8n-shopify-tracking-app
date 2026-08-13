import db from "../db.server";
import {
  generateEventIngestKey,
  hashEventIngestKey,
} from "./security/event-ingest-identity.server";
import { decryptToken, encryptToken } from "../lib/encryption.server";
import { getAssetSelections } from "./asset-selection.server";
import { getGa4DeliverySettings } from "./ga4-delivery-settings.server";
import { getTestModeSettings } from "./test-mode.server";
import { getOrCreateShopWorkspace } from "./workspace.server";

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
  let ga4Events: string[] = [];
  let metaEvents: string[] = [];
  let googleAdsConversions: Array<Record<string, unknown>> = [];
  let testModeSettings: Record<string, unknown> = { enabled: false, channels: {} };

  if (shopSettings?.workspaceId) {
    const [ga4, assets, testMode] = await Promise.all([
      getGa4DeliverySettings(shopSettings.workspaceId),
      getAssetSelections(shopSettings.workspaceId),
      getTestModeSettings(shopSettings.workspaceId),
    ]);
    ga4MeasurementId = ga4.credential?.assetId || ga4MeasurementId;
    ga4Enabled = Boolean(ga4MeasurementId && ga4.setting?.clientSideEnabled && ga4.setting?.deliveryMode !== "server");
    metaPixelId = String(assets["meta:Meta Dataset / Pixel"] || metaPixelId).trim();
    metaEnabled = Boolean(metaPixelId && String(assets["meta:Meta Client Side Enabled"] || "false") === "true");
    const rawGa4Events = String(
      assets["google:GA4 Property:events"] || ""
    ).trim();

    ga4Events =
      !rawGa4Events || rawGa4Events === "none"
        ? []
        : rawGa4Events
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);

    const rawEvents = String(assets["meta:Meta Selected Events"] || "");
    metaEvents = rawEvents === "none" ? [] : rawEvents.split(",").map((value) => value.trim()).filter(Boolean);
    const selectedGoogleAdsCustomerId = String(
      assets["google:Google Ads Account / Manager Account"] || ""
    )
      .replace(/-/g, "")
      .trim();

    googleAdsConversions = selectedGoogleAdsCustomerId
      ? await db.googleAdsConversionAction.findMany({
          where: {
            workspaceId: shopSettings.workspaceId,
            googleAdsCustomerId: selectedGoogleAdsCustomerId,
            isActive: true,
            deliveryMode: "client",
          },
          select: {
            eventName: true,
            conversionName: true,
            conversionId: true,
            conversionLabel: true,
            conversionActionId: true,
          },
        })
      : [];
    testModeSettings = {
      enabled: testMode.enabled,
      channels: Object.fromEntries(Object.entries(testMode.channels).map(([channel, value]) => [channel, (value as { effective: unknown }).effective])),
    };
  }

  const settings: Record<string, string> = {
    shop_domain: input.shop,
    ingest_key: input.ingestKey,
    ingestion_endpoint: INGESTION_ENDPOINT,

    /*
     * Enable flags can always be sent.
     *
     * Platform identifiers must only be included when
     * actually configured. Shopify rejects blank text
     * settings such as meta_pixel_id: "".
     */
    ga4_enabled: String(ga4Enabled),
    meta_enabled: String(metaEnabled),

    client_event_settings: JSON.stringify({
      ga4Events,
      metaEvents,
      googleAdsConversions,
    }),

    test_mode_settings:
      JSON.stringify(testModeSettings),
  };

  /*
   * These keys exist in the Shopify Web Pixel extension
   * settings schema, so Shopify expects them to be present.
   *
   * Use a harmless non-empty placeholder when that platform
   * has not been configured yet. The corresponding enabled
   * flag remains false, so the pixel will not send events
   * to that platform.
   */
  settings.ga4_measurement_id =
    ga4MeasurementId ||
    "not_configured";

  settings.meta_pixel_id =
    metaPixelId ||
    "not_configured";

  return settings;
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
  let stored = await db.shopSettings.findUnique({
    where: {
      shop: input.shop,
    },
    select: {
      workspaceId: true,
      encryptedEventIngestKey: true,
      eventIngestKeyHash: true,
    },
  });

  if (!stored) {
    throw new Error(
      "The shop settings record could not be found.",
    );
  }

  if (!stored.workspaceId) {
    const workspace = await getOrCreateShopWorkspace(
      input.shop,
    );

    stored = await db.shopSettings.update({
      where: {
        shop: input.shop,
      },
      data: {
        workspaceId: workspace.id,
      },
      select: {
        workspaceId: true,
        encryptedEventIngestKey: true,
        eventIngestKeyHash: true,
      },
    });
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
  /*
   * Pixel status is informational.
   *
   * A temporary Shopify Admin API failure, missing permission,
   * unavailable web-pixel object, or network problem must not
   * prevent the entire Configuration page from loading.
   *
   * Pixel create/update/rotate operations remain strict and
   * continue throwing their real errors.
   */
  const settingsPromise = db.shopSettings.findUnique({
    where: { shop },
    select: {
      eventIngestKeyHash: true,
      webPixelId: true,
      webPixelSyncError: true,
    },
  });

  let pixelId: string | null = null;
  let statusError: string | null = null;

  try {
    pixelId = await getWebPixelId(admin);
  } catch (error) {
    statusError =
      error instanceof Error
        ? error.message
        : "Unable to read the Shopify web pixel.";

    console.warn(
      "[Shopify Web Pixel] Status lookup failed",
      {
        shop,
        error: statusError,
      },
    );
  }

  const settings = await settingsPromise;

  return {
    pixelExists: Boolean(pixelId),
    ingestKeyConfigured: Boolean(
      settings?.eventIngestKeyHash,
    ),
    storedPixelId: settings?.webPixelId || null,
    statusError,
    lastSyncError:
      settings?.webPixelSyncError || null,
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
