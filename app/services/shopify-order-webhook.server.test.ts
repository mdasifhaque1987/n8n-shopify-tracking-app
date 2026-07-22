import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ActionFunctionArgs } from "react-router";
import { createOrdersCreateAction } from "./shopify-order-webhook-action.server";
import {
  persistVerifiedShopifyOrderWebhook,
  type WebhookPersistenceDependencies,
} from "./shopify-order-webhook.server";

const order = {
  id: 12345,
  created_at: new Date().toISOString(),
  total_price: "25.00",
  currency: "USD",
  line_items: [{ variant_id: 99, title: "Test item", price: "25.00", quantity: 1 }],
};

test("invalid webhook authentication is rejected before persistence", async () => {
  let persisted = false;
  const action = createOrdersCreateAction(
    async () => { throw new Error("Invalid webhook HMAC"); },
    async () => { persisted = true; return { jobId: "never" }; },
  );

  await assert.rejects(
    action({ request: new Request("https://app.test/webhooks/orders-create", { method: "POST" }) } as ActionFunctionArgs),
    /Invalid webhook HMAC/,
  );
  assert.equal(persisted, false);
});

test("duplicate verified order creates one durable job", async () => {
  const jobs = new Map<string, string>();
  const persistence: WebhookPersistenceDependencies = {
    async persist(input) {
      const key = `${input.shop}:${input.orderId}`;
      if (!jobs.has(key)) jobs.set(key, "job-1");
      return { jobId: jobs.get(key)! };
    },
  };

  await persistVerifiedShopifyOrderWebhook(
    { shop: "canonical.myshopify.com", payload: order },
    persistence,
  );
  await persistVerifiedShopifyOrderWebhook(
    { shop: "canonical.myshopify.com", payload: order },
    persistence,
  );

  assert.equal(jobs.size, 1);
});

test("persisted snapshot excludes plaintext protected customer data", async () => {
  const captured: Array<Parameters<WebhookPersistenceDependencies["persist"]>[0]> = [];
  await persistVerifiedShopifyOrderWebhook(
    {
      shop: "canonical.myshopify.com",
      payload: { ...order, email: "customer@example.com" },
    },
    {
      async persist(input) {
        captured.push(input);
        return { jobId: "job-1" };
      },
    },
  );

  const persisted = captured[0];
  assert.ok(persisted);
  assert.doesNotMatch(JSON.stringify(persisted.snapshot), /customer@example\.com/);
  assert.doesNotMatch(String(persisted.encryptedCustomerData), /customer@example\.com/);
});

test("database persistence failure returns non-2xx for Shopify retry", async () => {
  const action = createOrdersCreateAction(
    async () => ({ shop: "canonical.myshopify.com", payload: order }),
    async () => { throw new Error("database unavailable"); },
  );

  const response = await action({
    request: new Request("https://app.test/webhooks/orders-create", { method: "POST" }),
  } as ActionFunctionArgs);
  assert.equal(response.status, 503);
});

test("HTTP acknowledgement does no subscription or advertising API work", async () => {
  let persistenceCalls = 0;
  const action = createOrdersCreateAction(
    async () => ({ shop: "canonical.myshopify.com", payload: order }),
    async () => { persistenceCalls += 1; return { jobId: "job-1" }; },
  );

  const response = await action({
    request: new Request("https://app.test/webhooks/orders-create", { method: "POST" }),
  } as ActionFunctionArgs);
  assert.equal(response.status, 200);
  assert.equal(persistenceCalls, 1);

  const actionSource = await readFile(
    "app/services/shopify-order-webhook-action.server.ts",
    "utf8",
  );
  assert.doesNotMatch(
    actionSource,
    /verifyShopifyAppPricingSubscription|dispatchPurchaseToGoogleAds|dispatchToGA4|dispatchToMeta/,
  );
});

test("duplicate webhook cannot create duplicate platform delivery", async () => {
  const migration = await readFile(
    "prisma/migrations/20260722120000_add_event_ingest_key_and_order_receipts/migration.sql",
    "utf8",
  );
  assert.match(
    migration,
    /UNIQUE INDEX "ShopifyOrderPlatformDelivery_shop_orderId_platform_key"/,
  );
});
