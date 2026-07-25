import assert from "node:assert/strict";
import test from "node:test";
import type { ShopifyOrderJob, ShopifyOrderPlatformDelivery } from "@prisma/client";
import { encryptToken } from "../lib/encryption.server";
import {
  ORDER_WORKER_LEASE_MS,
  processNextOrderJob,
  type DeliveryDecision,
  type WorkerDependencies,
} from "./shopify-order-worker.server";

const now = new Date("2026-07-22T12:00:00.000Z");

function delivery(platform: string, status = "pending"): ShopifyOrderPlatformDelivery {
  return {
    id: `delivery-${platform}`,
    jobId: "job-1",
    shop: "canonical.myshopify.com",
    orderId: "12345",
    platform,
    testMode: false,
    testModeSource: "DEFAULT",
    testMechanism: "PRODUCTION",
    validationOnly: false,
    encryptedTestCode: null,
    status,
    attemptCount: status === "sent" ? 1 : 0,
    nextAttemptAt: now,
    lockedAt: null,
    leaseOwner: null,
    lastErrorCategory: null,
    completedAt: status === "sent" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function job(deliveries = [delivery("google_ads"), delivery("ga4"), delivery("meta")]) {
  return {
    id: "job-1",
    shop: "canonical.myshopify.com",
    orderId: "12345",
    webhookId: "webhook-1",
    orderSnapshot: {
      orderId: "12345",
      createdAt: now.toISOString(),
      currency: "USD",
      value: 25,
      tax: 0,
      shipping: 0,
      items: [],
    },
    encryptedCustomerData: null,
    encryptedTrackingIdentity: null,
    status: "processing",
    attemptCount: 1,
    nextAttemptAt: now,
    lockedAt: now,
    leaseOwner: "worker-1",
    lastErrorCategory: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deliveries,
  } as ShopifyOrderJob & { deliveries: ShopifyOrderPlatformDelivery[] };
}

function dependencies(overrides: Partial<WorkerDependencies> = {}) {
  const decisions = new Map<string, DeliveryDecision>();
  const dispatched: string[] = [];
  const base: WorkerDependencies = {
    async claimJob() { return job(); },
    async verifySubscription() { return { kind: "entitled" }; },
    async resolveWorkspace() { return "workspace-a"; },
    async getConfiguredPlatforms() { return { google_ads: true, ga4: true, meta: true }; },
    async markBlocked() {},
    async markDeliveryProcessing(row) { return row.includes("meta") ? 2 : 1; },
    async dispatch(platform) {
      dispatched.push(platform);
      return { success: true, status: "sent", message: "sent" };
    },
    async finishDelivery(row, decision) { decisions.set(row.platform, decision); },
    async writeDeliveryLog() {},
    async finishJob() {},
    async retryJob() {},
  };
  return { dependencies: { ...base, ...overrides }, decisions, dispatched };
}

test("temporary Partner API failure leaves the job retryable", async () => {
  let retryCategory = "";
  const setup = dependencies({
    async verifySubscription() { return { kind: "retry", category: "subscription_timeout" }; },
    async retryJob(_jobId, category) { retryCategory = category; },
  });

  await processNextOrderJob("worker-1", setup.dependencies, now);
  assert.equal(retryCategory, "subscription_timeout");
  assert.deepEqual(setup.dispatched, []);
});

test("confirmed Starter marks all platform deliveries plan_not_entitled", async () => {
  let blockedCategory = "";
  const setup = dependencies({
    async verifySubscription() { return { kind: "blocked", category: "plan_not_entitled" }; },
    async markBlocked(_jobId, category) { blockedCategory = category; },
  });

  await processNextOrderJob("worker-1", setup.dependencies, now);
  assert.equal(blockedCategory, "plan_not_entitled");
  assert.deepEqual(setup.dispatched, []);
});

test("Core Server processes configured platform deliveries", async () => {
  const setup = dependencies();
  await processNextOrderJob("worker-1", setup.dependencies, now);
  assert.deepEqual(setup.dispatched, ["google_ads", "ga4", "meta"]);
});

test("Google success remains sent while retryable Meta failure retries independently", async () => {
  const setup = dependencies({
    async dispatch(platform) {
      setup.dispatched.push(platform);
      return platform === "meta"
        ? { success: false, status: "failed", message: "Meta request failed with HTTP 503." }
        : { success: true, status: "sent", message: "sent" };
    },
  });

  await processNextOrderJob("worker-1", setup.dependencies, now);
  assert.equal(setup.decisions.get("google_ads")?.status, "sent");
  assert.equal(setup.decisions.get("meta")?.status, "retry");
});

test("an expired processing lease can be recovered by a new worker", async () => {
  const expiredAt = new Date(now.getTime() - ORDER_WORKER_LEASE_MS - 1);
  let claimedBy = "";
  const setup = dependencies({
    async claimJob(workerId) {
      claimedBy = workerId;
      return { ...job(), lockedAt: expiredAt, leaseOwner: "crashed-worker" };
    },
  });

  const processed = await processNextOrderJob("replacement-worker", setup.dependencies, now);
  assert.equal(processed, true);
  assert.equal(claimedBy, "replacement-worker");
});

test("already-sent platform is never resent", async () => {
  const setup = dependencies({
    async claimJob() { return job([delivery("google_ads", "sent"), delivery("meta")]); },
  });
  await processNextOrderJob("worker-1", setup.dependencies, now);
  assert.deepEqual(setup.dispatched, ["meta"]);
});


test("correlated DH Purchase event ID is reused for every platform", async () => {
  const correlatedEventId =
    "dh_1770635635835_177063554862011";

  const dispatchedEvents: Array<{
    platform: string;
    eventId: string;
  }> = [];

  const encryptedTrackingIdentity =
    encryptToken(
      JSON.stringify({
        clientId:
          "123456789.1760000000",
        sessionId:
          "1760000000",
        purchaseEventId:
          correlatedEventId,
        capturedAt:
          now.getTime(),
      }),
    );

  const setup = dependencies({
    async claimJob() {
      return {
        ...job(),
        encryptedTrackingIdentity,
      };
    },

    async dispatch(
      platform,
      event,
    ) {
      dispatchedEvents.push({
        platform,
        eventId:
          event.event_id,
      });

      return {
        success: true,
        status: "sent",
        message: "sent",
      };
    },
  });

  await processNextOrderJob(
    "worker-1",
    setup.dependencies,
    now,
  );

  assert.deepEqual(
    dispatchedEvents,
    [
      {
        platform:
          "google_ads",
        eventId:
          correlatedEventId,
      },
      {
        platform:
          "ga4",
        eventId:
          correlatedEventId,
      },
      {
        platform:
          "meta",
        eventId:
          correlatedEventId,
      },
    ],
  );

  assert.match(
    correlatedEventId,
    /^dh_\d+_\d+$/,
  );
});
