import { randomUUID } from "node:crypto";
import { Prisma, type ShopifyOrderJob, type ShopifyOrderPlatformDelivery } from "@prisma/client";
import db from "../db.server";
import { decryptToken } from "../lib/encryption.server";
import {
  createDhUniqueEventId,
  isDhUniqueEventId,
} from "../lib/utils/dh-event-id";
import { dispatchPurchaseToGoogleAds } from "./dispatchers/google-ads.dispatcher";
import { dispatchToGA4 } from "./dispatchers/ga4.dispatcher";
import { dispatchToMeta } from "./dispatchers/meta.dispatcher";
import { getAssetSelections } from "./asset-selection.server";
import { createEventDeliveryLog } from "./event-delivery-log.server";
import type { NormalizedTrackingEvent } from "./normalize-event.server";
import { verifyShopifyAppPricingSubscription } from "./shopify-app-pricing.server";
import type { MinimizedOrderSnapshot, OrderDeliveryPlatform } from "./shopify-order-webhook.server";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

type ClaimedJob = ShopifyOrderJob & { deliveries: ShopifyOrderPlatformDelivery[] };
type DispatchResult = {
  success: boolean;
  status: string;
  message: string;
  responsePayload?: Record<string, unknown>;
};

export type SubscriptionDecision =
  | { kind: "entitled" }
  | { kind: "blocked"; category: string }
  | { kind: "retry"; category: string };

export type DeliveryDecision =
  | { status: "sent"; category: null }
  | { status: "skipped" | "failed"; category: string }
  | { status: "retry"; category: string };

export function exponentialBackoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** exponent));
}

function statusCodeFromResult(result: DispatchResult): number | null {
  const responseStatus = Number(result.responsePayload?.statusCode);
  if (Number.isFinite(responseStatus) && responseStatus > 0) return responseStatus;

  const match = result.message.match(/(?:HTTP|status)\s+(\d{3})/i);
  return match ? Number(match[1]) : null;
}

export function classifyDeliveryResult(
  result: DispatchResult,
  attempt: number,
): DeliveryDecision {
  if (result.success || result.status === "sent" || result.status === "success") {
    return { status: "sent", category: null };
  }

  if (result.status === "skipped") {
    return { status: "skipped", category: "invalid_configuration" };
  }

  const statusCode = statusCodeFromResult(result);
  const retryableStatus = statusCode === 429 || Boolean(statusCode && statusCode >= 500);
  const retryableMessage = /timeout|timed out|network|fetch failed|ECONN|socket|temporar|rate limit/i.test(result.message);

  if ((retryableStatus || retryableMessage || statusCode === null) && attempt < MAX_ATTEMPTS) {
    return {
      status: "retry",
      category: statusCode === 429
        ? "rate_limited"
        : retryableMessage && /timeout|timed out/i.test(result.message)
          ? "timeout"
          : statusCode && statusCode >= 500
            ? "service_unavailable"
            : "network_or_unknown",
    };
  }

  return {
    status: "failed",
    category: attempt >= MAX_ATTEMPTS ? "retry_exhausted" : "permanent_api_rejection",
  };
}

function snapshotFromJob(job: ClaimedJob): MinimizedOrderSnapshot {
  return job.orderSnapshot as unknown as MinimizedOrderSnapshot;
}

function workerRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function decryptWorkerRecord(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return workerRecord(
      JSON.parse(
        decryptToken(value),
      ),
    );
  } catch {
    return {};
  }
}

function workerText(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : String(value).trim();
}

function cleanShopifyIdentifier(value: unknown): string {
  const normalized = workerText(value);

  if (normalized.startsWith("gid://")) {
    return normalized.split("/").pop() || "";
  }

  return normalized;
}

function positiveWorkerQuantity(value: unknown): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 1;
}

function finiteWorkerNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

export function buildMetaCatalogContentId(
  itemValue: unknown,
  itemIdFormat: string,
): string {
  const item = workerRecord(itemValue);

  const rawProductId =
    item.product_id ||
    item.item_group_id ||
    item.productId ||
    item.id ||
    item.item_id ||
    "";

  const rawVariantId =
    item.variant_id ||
    item.variantId ||
    item.sku ||
    item.item_id ||
    item.id ||
    "";

  const productId =
    cleanShopifyIdentifier(rawProductId);

  const variantId =
    cleanShopifyIdentifier(rawVariantId);

  const itemId =
    cleanShopifyIdentifier(
      item.item_id ||
      item.id ||
      productId ||
      variantId,
    );

  const sku = workerText(item.sku);

  if (itemIdFormat === "product_id") {
    return productId || itemId;
  }

  if (itemIdFormat === "variant_id") {
    return variantId || itemId;
  }

  if (itemIdFormat === "sku") {
    return sku || variantId || itemId;
  }

  if (itemIdFormat === "product_variant") {
    if (productId && variantId) {
      return `${productId}_${variantId}`;
    }

    return itemId || productId || variantId;
  }

  if (itemIdFormat === "shopify_country_product_variant") {
    const country = workerText(
      item.country ||
      item.item_country ||
      item.currency_country ||
      "US",
    ).toUpperCase();

    if (productId && variantId) {
      return `shopify_${country}_${productId}_${variantId}`;
    }

    return itemId || productId || variantId;
  }

  return itemId || productId || variantId;
}

function applyMetaContentIdFormat(
  event: NormalizedTrackingEvent,
  itemIdFormat: string,
): void {
  const ecommerce = workerRecord(event.ecommerce);

  const items = Array.isArray(ecommerce.items)
    ? ecommerce.items
    : [];

  const contentIds: string[] = [];
  const contents: Array<Record<string, unknown>> = [];

  for (const itemValue of items) {
    const item = workerRecord(itemValue);

    const id = buildMetaCatalogContentId(
      item,
      itemIdFormat,
    );

    if (!id) {
      continue;
    }

    contentIds.push(id);

    contents.push({
      id,
      quantity: positiveWorkerQuantity(
        item.quantity,
      ),
      item_price:
        finiteWorkerNumber(
          item.item_price,
        ) ??
        finiteWorkerNumber(
          item.price,
        ),
    });
  }

  const existingMeta =
    workerRecord(event.meta);

  event.meta = {
    ...existingMeta,
    event_name:
      event.meta_event ||
      workerText(
        existingMeta.event_name,
      ) ||
      "Purchase",
    content_type:
      workerText(
        existingMeta.content_type,
      ) ||
      "product",
    content_ids: contentIds,
    contents,
  };
}

function eventFromJob(job: ClaimedJob): NormalizedTrackingEvent {
  const snapshot = snapshotFromJob(job);
  const customer =
    decryptWorkerRecord(
      job.encryptedCustomerData,
    );

  const trackingIdentity =
    decryptWorkerRecord(
      job.encryptedTrackingIdentity,
    );

  const correlatedPurchaseEventId =
    workerText(
      trackingIdentity.purchaseEventId ||
      trackingIdentity.purchase_event_id,
    );

  const purchaseEventId =
    isDhUniqueEventId(
      correlatedPurchaseEventId,
    )
      ? correlatedPurchaseEventId
      : createDhUniqueEventId(0);

  const gaClientId =
    workerText(
      trackingIdentity.clientId,
    );

  const gaSessionId =
    workerText(
      trackingIdentity.sessionId,
    );

  const address = customer.address && typeof customer.address === "object"
    ? customer.address as Record<string, unknown>
    : {};
  const items = snapshot.items.map((item) => ({
    id: item.itemId,
    item_id: item.itemId,
    item_name: item.itemName,
    item_brand: item.itemBrand,
    product_id: item.productId,
    variant_id: item.variantId,
    item_variant: item.itemVariant,
    item_category: item.itemCategory,
    price: item.price,
    discount: item.discount,
    quantity: item.quantity,
    sku: item.sku,
  }));

  return {
    shop: job.shop,
    event_name: "purchase",
    meta_event: "Purchase",
    event_id: purchaseEventId,
    event_time: snapshot.createdAt && Number.isFinite(Date.parse(snapshot.createdAt))
      ? Math.floor(Date.parse(snapshot.createdAt) / 1000)
      : Math.floor(job.createdAt.getTime() / 1000),
    client_id:
      gaClientId || undefined,
    transaction_id: job.orderId,
    raw:
      gaClientId || gaSessionId
        ? {
            client_id:
              gaClientId ||
              undefined,
            session_id:
              gaSessionId ||
              undefined,
          }
        : undefined,
    customer: {
      email: customer.email,
      phone: customer.phone,
      first_name: customer.firstName,
      last_name: customer.lastName,
      customer_id: customer.customerId,
      address,
    },
    ecommerce: {
      transaction_id: job.orderId,
      value: snapshot.value,
      currency: snapshot.currency,
      tax: snapshot.tax,
      shipping: snapshot.shipping,
      items,
    },
    meta: {
      event_name: "Purchase",
      content_type: "product",
      content_ids: snapshot.items.map((item) => item.itemId),
      contents: snapshot.items.map((item) => ({
        id: item.itemId,
        quantity: item.quantity,
        item_price: item.price,
      })),
    },
  };
}

export type WorkerDependencies = {
  claimJob(workerId: string, now: Date): Promise<ClaimedJob | null>;
  verifySubscription(shop: string): Promise<SubscriptionDecision>;
  resolveWorkspace(shop: string): Promise<string | null>;
  getConfiguredPlatforms(workspaceId: string): Promise<Record<OrderDeliveryPlatform, boolean>>;
  markBlocked(jobId: string, category: string): Promise<void>;
  markDeliveryProcessing(deliveryId: string, workerId: string): Promise<number>;
  dispatch(platform: OrderDeliveryPlatform, event: NormalizedTrackingEvent, workspaceId: string, delivery: ShopifyOrderPlatformDelivery): Promise<DispatchResult>;
  finishDelivery(delivery: ShopifyOrderPlatformDelivery, decision: DeliveryDecision, attempt: number, now: Date): Promise<void>;
  writeDeliveryLog(platform: OrderDeliveryPlatform, event: NormalizedTrackingEvent, workspaceId: string, decision: DeliveryDecision): Promise<void>;
  finishJob(jobId: string, now: Date): Promise<void>;
  retryJob(jobId: string, category: string, attempt: number, now: Date): Promise<void>;
};

const defaultDependencies: WorkerDependencies = {
  async claimJob(workerId, now) {
    const leaseExpiredAt = new Date(now.getTime() - LEASE_MS);

    return db.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "ShopifyOrderJob"
        WHERE (
          ("status" IN ('pending', 'retry') AND "nextAttemptAt" <= ${now})
          OR ("status" = 'processing' AND "lockedAt" <= ${leaseExpiredAt})
        )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const jobId = rows[0]?.id;
      if (!jobId) return null;

      await tx.shopifyOrderPlatformDelivery.updateMany({
        where: { jobId, status: "processing", lockedAt: { lte: leaseExpiredAt } },
        data: { status: "retry", lockedAt: null, leaseOwner: null, nextAttemptAt: now },
      });
      await tx.shopifyOrderJob.update({
        where: { id: jobId },
        data: {
          status: "processing",
          attemptCount: { increment: 1 },
          lockedAt: now,
          leaseOwner: workerId,
          lastErrorCategory: null,
        },
      });

      return tx.shopifyOrderJob.findUnique({ where: { id: jobId }, include: { deliveries: true } });
    }) as Promise<ClaimedJob | null>;
  },
  async verifySubscription(shop) {
    try {
      const { unauthenticated } = await import("../shopify.server.js");
      const { admin } = await unauthenticated.admin(shop);
      const result = await verifyShopifyAppPricingSubscription({ shop, admin });

      if (!result.ok) {
        return result.retryable
          ? { kind: "retry", category: result.errorCategory || "subscription_unavailable" }
          : { kind: "blocked", category: result.errorCategory || "plan_not_entitled" };
      }

      return (result.status === "active" || result.status === "trial") && result.planHandle === "core-server"
        ? { kind: "entitled" }
        : { kind: "blocked", category: "plan_not_entitled" };
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      return {
        kind: "retry",
        category: name === "AbortError" ? "subscription_timeout" : "shopify_session_unavailable",
      };
    }
  },
  async resolveWorkspace(shop) {
    const settings = await db.shopSettings.findUnique({ where: { shop }, select: { workspaceId: true } });
    return settings?.workspaceId || null;
  },
  async getConfiguredPlatforms(workspaceId) {
    const [googleAds, ga4, metaSelections] = await Promise.all([
      db.googleAdsConversionAction.count({
        where: { workspaceId, eventName: "PURCHASE", isActive: true, deliveryMode: "server" },
      }),
      db.platformDeliverySetting.findUnique({
        where: { workspaceId_platform: { workspaceId, platform: "GA4" } },
        select: { isActive: true, serverSideEnabled: true, deliveryMode: true },
      }),
      db.shopAssetSelection.findMany({
        where: {
          workspaceId,
          platform: "meta",
          assetType: { in: ["Meta Server Side Enabled", "Meta Dataset / Pixel", "Meta CAPI Access Token"] },
        },
        select: { assetType: true, assetValue: true },
      }),
    ]);
    const meta = new Map(metaSelections.map((item: { assetType: string; assetValue: string }) => [item.assetType, item.assetValue]));

    return {
      google_ads: googleAds > 0,
      ga4: Boolean(ga4?.isActive && (ga4.serverSideEnabled || ga4.deliveryMode === "server")),
      meta: meta.get("Meta Server Side Enabled") === "true" &&
        Boolean(meta.get("Meta Dataset / Pixel")) && Boolean(meta.get("Meta CAPI Access Token")),
    };
  },
  async markBlocked(jobId, category) {
    await db.$transaction([
      db.shopifyOrderPlatformDelivery.updateMany({
        where: { jobId, status: { in: ["pending", "retry", "processing"] } },
        data: { status: "skipped", lastErrorCategory: category, completedAt: new Date(), lockedAt: null, leaseOwner: null },
      }),
      db.shopifyOrderJob.update({
        where: { id: jobId },
        data: { status: "blocked", lastErrorCategory: category, completedAt: new Date(), lockedAt: null, leaseOwner: null },
      }),
    ]);
  },
  async markDeliveryProcessing(deliveryId, workerId) {
    const delivery = await db.shopifyOrderPlatformDelivery.update({
      where: { id: deliveryId },
      data: { status: "processing", attemptCount: { increment: 1 }, lockedAt: new Date(), leaseOwner: workerId },
      select: { attemptCount: true },
    });
    return delivery.attemptCount;
  },
  async dispatch(platform, event, workspaceId, delivery) {
    const options = {
      testMode: delivery.testMode,
      validationOnly: delivery.validationOnly,
    };

    if (platform === "google_ads") {
      return dispatchPurchaseToGoogleAds(
        event,
        workspaceId,
        options,
      );
    }

    if (platform === "ga4") {
      return dispatchToGA4(
        event,
        workspaceId,
        options,
      );
    }

    const selectedAssets =
      await getAssetSelections(
        workspaceId,
      );

    const metaContentIdFormat =
      String(
        selectedAssets[
          "meta:Meta Content ID Format"
        ] ||
        "shopify_country_product_variant",
      ).trim();

    applyMetaContentIdFormat(
      event,
      metaContentIdFormat,
    );

    return dispatchToMeta(
      event,
      workspaceId,
      {
        testMode:
          delivery.testMode,
        testEventCodeOverride:
          delivery.encryptedTestCode
            ? decryptToken(
                delivery.encryptedTestCode,
              )
            : null,
      },
    );
  },
  async finishDelivery(delivery, decision, attempt, now) {
    const completed = decision.status === "sent" || decision.status === "skipped" || decision.status === "failed";
    await db.shopifyOrderPlatformDelivery.update({
      where: { id: delivery.id },
      data: {
        status: decision.status,
        lastErrorCategory: decision.category,
        nextAttemptAt: decision.status === "retry"
          ? new Date(now.getTime() + exponentialBackoffMs(attempt))
          : now,
        completedAt: completed ? now : null,
        lockedAt: null,
        leaseOwner: null,
      },
    });
  },
  async writeDeliveryLog(platform, event, workspaceId, decision) {
    await createEventDeliveryLog({
      workspaceId,
      shop: event.shop,
      event,
      platform,
      deliveryType: "server",
      status: decision.status === "retry" ? "failed" : decision.status,
      message: decision.category ? `Order delivery ${decision.status}: ${decision.category}.` : "Order delivery sent.",
      responsePayload: { source: "shopify_order_worker", errorCategory: decision.category },
    });
  },
  async finishJob(jobId, now) {
    const deliveries = await db.shopifyOrderPlatformDelivery.findMany({ where: { jobId } });
    const retryable = deliveries.filter((delivery: ShopifyOrderPlatformDelivery) =>
      ["pending", "processing", "retry"].includes(delivery.status));
    const hasFailed = deliveries.some((delivery: ShopifyOrderPlatformDelivery) => delivery.status === "failed");

    if (retryable.length) {
      const nextAttemptAt = retryable.reduce(
        (earliest: Date, delivery: ShopifyOrderPlatformDelivery) =>
          delivery.nextAttemptAt < earliest ? delivery.nextAttemptAt : earliest,
        retryable[0].nextAttemptAt,
      );
      await db.shopifyOrderJob.update({
        where: { id: jobId },
        data: { status: "retry", nextAttemptAt, lockedAt: null, leaseOwner: null },
      });
      return;
    }

    await db.shopifyOrderJob.update({
      where: { id: jobId },
      data: {
        status: hasFailed ? "failed" : "completed",
        completedAt: now,
        lockedAt: null,
        leaseOwner: null,
      },
    });
  },
  async retryJob(jobId, category, attempt, now) {
    const exhausted = attempt >= MAX_ATTEMPTS;
    await db.shopifyOrderJob.update({
      where: { id: jobId },
      data: {
        status: exhausted ? "failed" : "retry",
        nextAttemptAt: new Date(now.getTime() + exponentialBackoffMs(attempt)),
        lastErrorCategory: exhausted ? "subscription_retry_exhausted" : category,
        completedAt: exhausted ? now : null,
        lockedAt: null,
        leaseOwner: null,
      },
    });
  },
};

export async function processNextOrderJob(
  workerId: string = randomUUID(),
  dependencies: WorkerDependencies = defaultDependencies,
  now = new Date(),
): Promise<boolean> {
  const job = await dependencies.claimJob(workerId, now);
  if (!job) return false;

  const subscription = await dependencies.verifySubscription(job.shop);
  if (subscription.kind === "retry") {
    await dependencies.retryJob(job.id, subscription.category, job.attemptCount, now);
    return true;
  }
  if (subscription.kind === "blocked") {
    await dependencies.markBlocked(job.id, subscription.category);
    return true;
  }

  const workspaceId = await dependencies.resolveWorkspace(job.shop);
  if (!workspaceId) {
    await dependencies.retryJob(job.id, "workspace_unavailable", job.attemptCount, now);
    return true;
  }

  const configured = await dependencies.getConfiguredPlatforms(workspaceId);
  const event = eventFromJob(job);

  for (const delivery of job.deliveries) {
    if (["sent", "skipped", "failed"].includes(delivery.status)) continue;
    if (delivery.status === "retry" && delivery.nextAttemptAt > now) continue;
    const platform = delivery.platform as OrderDeliveryPlatform;

    if (!configured[platform]) {
      const decision: DeliveryDecision = { status: "skipped", category: "invalid_configuration" };
      await dependencies.finishDelivery(delivery, decision, delivery.attemptCount, now);
      await dependencies.writeDeliveryLog(platform, event, workspaceId, decision);
      continue;
    }

    const attempt = await dependencies.markDeliveryProcessing(delivery.id, workerId);
    let decision: DeliveryDecision;
    try {
      const result = await dependencies.dispatch(platform, event, workspaceId, delivery);
      decision = classifyDeliveryResult(result, attempt);
    } catch (error) {
      const message = error instanceof Error ? error.name : "dispatch_error";
      decision = classifyDeliveryResult(
        { success: false, status: "failed", message },
        attempt,
      );
    }
    await dependencies.finishDelivery(delivery, decision, attempt, now);
    await dependencies.writeDeliveryLog(platform, event, workspaceId, decision);
  }

  await dependencies.finishJob(job.id, now);
  return true;
}

export const ORDER_WORKER_LEASE_MS = LEASE_MS;
