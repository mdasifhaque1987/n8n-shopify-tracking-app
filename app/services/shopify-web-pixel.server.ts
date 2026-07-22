import db from "../db.server";
import {
  generateEventIngestKey,
  hashEventIngestKey,
} from "./security/event-ingest-identity.server";

type AdminGraphql = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

type PixelResult = {
  errors?: Array<{ message: string }>;
  data?: {
    webPixel?: { id: string } | null;
    webPixelCreate?: {
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
    webPixelUpdate?: {
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
};

async function getWebPixelId(admin: AdminGraphql): Promise<string | null> {
  const response = await admin.graphql(`
    #graphql
    query EventIngestWebPixel {
      webPixel {
        id
      }
    }
  `);
  const result = (await response.json()) as PixelResult;

  if (result.errors?.length) {
    throw new Error("Unable to read the Shopify web pixel.");
  }

  return result.data?.webPixel?.id || null;
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
  const pixelId = await getWebPixelId(input.admin);
  const webPixel = {
    settings: JSON.stringify({
      shop_domain: input.shop,
      ingest_key: ingestKey,
    }),
  };

  const response = pixelId
    ? await input.admin.graphql(
        `
          #graphql
          mutation UpdateEventIngestWebPixel($id: ID!, $webPixel: WebPixelInput!) {
            webPixelUpdate(id: $id, webPixel: $webPixel) {
              userErrors { field message }
            }
          }
        `,
        { variables: { id: pixelId, webPixel } },
      )
    : await input.admin.graphql(
        `
          #graphql
          mutation CreateEventIngestWebPixel($webPixel: WebPixelInput!) {
            webPixelCreate(webPixel: $webPixel) {
              userErrors { field message }
            }
          }
        `,
        { variables: { webPixel } },
      );

  const result = (await response.json()) as PixelResult;
  const operation = pixelId ? result.data?.webPixelUpdate : result.data?.webPixelCreate;
  const errors = operation?.userErrors || [];

  if (result.errors?.length || !operation) {
    throw new Error("Shopify did not accept the web pixel update.");
  }

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  await db.shopSettings.upsert({
    where: { shop: input.shop },
    create: {
      shop: input.shop,
      workspaceId: input.workspaceId,
      eventIngestKeyHash: keyHash,
    },
    update: {
      workspaceId: input.workspaceId,
      eventIngestKeyHash: keyHash,
    },
  });

  return { created: !pixelId };
}
