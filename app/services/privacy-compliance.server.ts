import { Prisma } from "@prisma/client";
import db from "../db.server";

type CompliancePayload = Record<string, unknown>;

function cleanShop(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function normalizeOrderId(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
}

function orderIdsFromPayload(payload: CompliancePayload): string[] {
  const values = [
    payload.orders_to_redact,
    payload.orders_requested,
  ];

  const ids = values.flatMap((value) => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(normalizeOrderId)
      .filter((item): item is string => Boolean(item));
  });

  return [...new Set(ids)];
}

/**
 * Event delivery logs never store raw customer email, phone,
 * name, or address. They can contain a Shopify transaction ID,
 * so logs for orders identified by Shopify are removed.
 */
export async function redactCustomerData(
  shopInput: unknown,
  payloadInput: unknown,
) {
  const shop = cleanShop(shopInput);
  const payload =
    payloadInput && typeof payloadInput === "object"
      ? (payloadInput as CompliancePayload)
      : {};

  const orderIds = orderIdsFromPayload(payload);

  if (!shop || orderIds.length === 0) {
    return {
      shop,
      orderIdsReceived: orderIds.length,
      deliveryLogsDeleted: 0,
      orderJobsDeleted: 0,
    };
  }

  const transactionFilters = orderIds.map((orderId) =>
    Prisma.sql`
      ("requestPayload" #>> '{ecommerce,transaction_id}') = ${orderId}
    `,
  );

  const deleted = await db.$executeRaw(
    Prisma.sql`
      DELETE FROM "EventDeliveryLog"
      WHERE "shop" = ${shop}
        AND (
          ${Prisma.join(transactionFilters, " OR ")}
        )
    `,
  );

  return {
    shop,
    orderIdsReceived: orderIds.length,
    deliveryLogsDeleted: Number(deleted),
  };
}

/**
 * Removes all data that belongs exclusively to a Shopify shop.
 *
 * Workspaces shared by more than one shop are preserved.
 * Synthetic workspace owners are removed only when they no
 * longer own or belong to another workspace.
 */
export async function redactShopData(shopInput: unknown) {
  const shop = cleanShop(shopInput);

  if (!shop) {
    return {
      shop,
      sessionsDeleted: 0,
      settingsDeleted: 0,
      deliveryLogsDeleted: 0,
      oauthStatesDeleted: 0,
      workspaceDeleted: false,
      ownerDeleted: false,
    };
  }

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const settings = await tx.shopSettings.findUnique({
      where: { shop },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            ownerId: true,
          },
        },
      },
    });

    const workspaceId = settings?.workspaceId || null;
    const ownerId = settings?.workspace?.ownerId || null;

    const workspaceShopLinks = workspaceId
      ? await tx.shopSettings.count({
          where: { workspaceId },
        })
      : 0;

    const workspaceIsExclusive =
      Boolean(workspaceId) &&
      workspaceShopLinks <= 1;

    const deliveryLogWhere: Prisma.EventDeliveryLogWhereInput =
      workspaceId && workspaceIsExclusive
        ? {
            OR: [
              { shop },
              { workspaceId },
            ],
          }
        : { shop };

    const deliveryLogs = await tx.eventDeliveryLog.deleteMany({
      where: deliveryLogWhere,
    });

    const orderJobs = await tx.shopifyOrderJob.deleteMany({ where: { shop } });

    const sessions = await tx.session.deleteMany({
      where: { shop },
    });

    const shopSettings = await tx.shopSettings.deleteMany({
      where: { shop },
    });

    let oauthStatesDeleted = 0;
    let workspaceDeleted = false;
    let ownerDeleted = false;

    if (workspaceId && workspaceShopLinks <= 1) {
      const oauthStates = await tx.oAuthState.deleteMany({
        where: { workspaceId },
      });

      oauthStatesDeleted = oauthStates.count;

      const workspace = await tx.workspace.deleteMany({
        where: { id: workspaceId },
      });

      workspaceDeleted = workspace.count > 0;

      if (ownerId) {
        const owner = await tx.user.findUnique({
          where: { id: ownerId },
          select: {
            email: true,
            _count: {
              select: {
                ownedWorkspaces: true,
                workspaceMemberships: true,
              },
            },
          },
        });

        const isSyntheticOwner =
          owner?.email.endsWith("@workspace.local") === true;

        const hasNoWorkspaceRelationships =
          owner?._count.ownedWorkspaces === 0 &&
          owner?._count.workspaceMemberships === 0;

        if (isSyntheticOwner && hasNoWorkspaceRelationships) {
          const removedOwner = await tx.user.deleteMany({
            where: { id: ownerId },
          });

          ownerDeleted = removedOwner.count > 0;
        }
      }
    }

    return {
      shop,
      sessionsDeleted: sessions.count,
      settingsDeleted: shopSettings.count,
      deliveryLogsDeleted: deliveryLogs.count,
      orderJobsDeleted: orderJobs.count,
      oauthStatesDeleted,
      workspaceDeleted,
      ownerDeleted,
    };
  });
}
