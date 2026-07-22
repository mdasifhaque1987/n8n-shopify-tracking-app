import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSubmittedShopMatches,
  EventIngestKeyError,
  EventIngestShopMismatchError,
  hashEventIngestKey,
  resolveEventIngestInstallation,
} from "./event-ingest-identity.server";

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);

function request(key?: string) {
  return new Request("https://tracking.example/api/events/track", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

function lookup(records: Record<string, { id: number; shop: string; workspaceId: string }>) {
  return {
    async findUnique({ where }: { where: { eventIngestKeyHash: string } }) {
      return records[where.eventIngestKeyHash] || null;
    },
  };
}

test("valid installation key resolves its canonical shop and workspace", async () => {
  const context = await resolveEventIngestInstallation(
    request(TOKEN_A),
    lookup({
      [hashEventIngestKey(TOKEN_A)]: {
        id: 7,
        shop: "canonical.myshopify.com",
        workspaceId: "workspace-a",
      },
    }),
  );

  assert.deepEqual(context, {
    installationId: 7,
    shop: "canonical.myshopify.com",
    workspaceId: "workspace-a",
  });
});

test("missing and invalid installation keys are rejected identically", async () => {
  await assert.rejects(resolveEventIngestInstallation(request(), lookup({})), EventIngestKeyError);
  await assert.rejects(resolveEventIngestInstallation(request("short"), lookup({})), EventIngestKeyError);
  await assert.rejects(resolveEventIngestInstallation(request(TOKEN_B), lookup({})), EventIngestKeyError);
});

test("submitted shop mismatch is rejected", () => {
  assert.throws(
    () => assertSubmittedShopMatches("other.myshopify.com", "canonical.myshopify.com"),
    EventIngestShopMismatchError,
  );
});

test("an installation key cannot select another workspace", async () => {
  const records = {
    [hashEventIngestKey(TOKEN_A)]: { id: 1, shop: "a.myshopify.com", workspaceId: "workspace-a" },
    [hashEventIngestKey(TOKEN_B)]: { id: 2, shop: "b.myshopify.com", workspaceId: "workspace-b" },
  };
  const context = await resolveEventIngestInstallation(request(TOKEN_A), lookup(records));

  assert.equal(context.workspaceId, "workspace-a");
  assert.notEqual(context.workspaceId, "workspace-b");
});
