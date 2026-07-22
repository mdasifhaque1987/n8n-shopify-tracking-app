import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public pixel purchase path cannot invoke Shopify Admin enrichment or server dispatch", async () => {
  const source = await readFile("app/routes/api.events.track.tsx", "utf8");

  assert.doesNotMatch(source, /enrichShopifyOrderCustomer/);
  assert.doesNotMatch(source, /dispatchPurchaseToGoogleAds|dispatchToGA4|dispatchToMeta/);
});
