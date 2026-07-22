import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubscriptionEntitlements } from "./subscription.server";

test("Core Starter blocks all server dispatch entitlements", () => {
  const entitlements = resolveSubscriptionEntitlements({
    subscriptionPlan: "core-starter",
    subscriptionStatus: "active",
  });

  assert.equal(entitlements.googleClientSide, true);
  assert.equal(entitlements.metaClientSide, true);
  assert.equal(entitlements.googleAdsServerSide, false);
  assert.equal(entitlements.ga4ServerSide, false);
  assert.equal(entitlements.metaCapi, false);
});

test("verified Core Server allows all server dispatch entitlements", () => {
  const entitlements = resolveSubscriptionEntitlements({
    subscriptionPlan: "core-server",
    subscriptionStatus: "active",
  });

  assert.equal(entitlements.googleAdsServerSide, true);
  assert.equal(entitlements.ga4ServerSide, true);
  assert.equal(entitlements.metaCapi, true);
});
