import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectiveTestMode } from "./test-mode.server";

test("global mode affects only selected channels", () => {
  assert.equal(resolveEffectiveTestMode({ channel: "ga4_client", globalEnabled: true, globallySelected: true }).enabled, true);
  assert.equal(resolveEffectiveTestMode({ channel: "meta_pixel", globalEnabled: true, globallySelected: false }).enabled, false);
});

test("enabled override wins when global mode is disabled", () => {
  const result = resolveEffectiveTestMode({ channel: "ga4_client", globalEnabled: false, globallySelected: false, override: "ENABLED" });
  assert.deepEqual(result, { enabled: true, source: "PLATFORM_OVERRIDE", mechanism: "GA4_DEBUG_MODE" });
});

test("disabled override wins when global mode selected", () => {
  const result = resolveEffectiveTestMode({ channel: "meta_capi", globalEnabled: true, globallySelected: true, override: "DISABLED" });
  assert.equal(result.enabled, false);
  assert.equal(result.source, "PLATFORM_OVERRIDE");
});
