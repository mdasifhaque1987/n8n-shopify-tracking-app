import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverGa4Properties,
  formatGa4PropertyLabel,
  reconcileGa4Selection,
} from "./ga4-property-discovery.server";
import {
  getGa4ApiSecretTitleColor,
  getGa4EmptyOptionText,
  getGa4PropertyDisplayOptions,
  getSavedGa4PropertyOption,
  isGa4ApiSecretConfigured,
} from "./ga4-settings-display";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("discovers properties across accounts and every page, removing duplicates", async () => {
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (!url.includes("pageToken=page-2")) {
      return jsonResponse({
        accountSummaries: [
          {
            account: "accounts/10",
            displayName: "Main Account",
            propertySummaries: [
              { property: "properties/100", displayName: "Web", propertyType: "PROPERTY_TYPE_ORDINARY" },
            ],
          },
        ],
        nextPageToken: "page-2",
      });
    }
    return jsonResponse({
      accountSummaries: [
        {
          account: "accounts/20",
          displayName: "Agency Account",
          propertySummaries: [
            { property: "properties/100", displayName: "Duplicate" },
            { property: "properties/200", displayName: "Shop", canEdit: true },
          ],
        },
      ],
    });
  };

  const properties = await discoverGa4Properties("test-token", fetcher);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /pageSize=200/);
  assert.deepEqual(properties.map((property) => property.propertyId), ["100", "200"]);
  assert.equal(properties[1].accountId, "20");
  assert.equal(properties[1].accountDisplayName, "Agency Account");
  assert.equal(properties[1].resourceName, "properties/200");
  assert.equal(properties[1].canEdit, true);
});

test("keeps a saved accessible property and clears a stale one", () => {
  const properties = [{
    propertyId: "100", resourceName: "properties/100", displayName: "Web",
    accountId: "10", accountDisplayName: "Main", propertyType: "",
  }];
  assert.deepEqual(reconcileGa4Selection("100", properties), {
    selectedPropertyId: "100", stale: false,
  });
  assert.deepEqual(reconcileGa4Selection("999", properties), {
    selectedPropertyId: "", stale: true,
  });
});

test("formats property labels with property, account, and ID", () => {
  assert.equal(formatGa4PropertyLabel({
    propertyId: "406009901", resourceName: "properties/406009901",
    displayName: "DH Store", accountId: "10", accountDisplayName: "DH Group",
    propertyType: "PROPERTY_TYPE_ORDINARY",
  }), "DH Store — DH Group (406009901)");
});

test("an empty accessible response returns no properties", async () => {
  const properties = await discoverGa4Properties(
    "test-token",
    async () => jsonResponse({ accountSummaries: [] })
  );
  assert.deepEqual(properties, []);
});

test("each discovery call fetches a completely fresh property list", async () => {
  let propertyId = "100";
  const fetcher: typeof fetch = async () => jsonResponse({
    accountSummaries: [{
      account: "accounts/10",
      propertySummaries: [{ property: `properties/${propertyId}` }],
    }],
  });
  assert.equal((await discoverGa4Properties("new-token-1", fetcher))[0].propertyId, "100");
  propertyId = "200";
  assert.equal((await discoverGa4Properties("new-token-2", fetcher))[0].propertyId, "200");
});

test("distinguishes Analytics Admin API disabled from insufficient permission", async () => {
  await assert.rejects(
    discoverGa4Properties("test-token", async () =>
      jsonResponse({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, 403)
    ),
    (error: unknown) => error instanceof Error && "category" in error && error.category === "api_disabled"
  );
});

test("a later-page failure is reported as pagination failure", async () => {
  let request = 0;
  await assert.rejects(
    discoverGa4Properties("test-token", async () => {
      request += 1;
      return request === 1
        ? jsonResponse({ nextPageToken: "next" })
        : jsonResponse({}, 500);
    }),
    (error: unknown) =>
      error instanceof Error &&
      "category" in error &&
      error.category === "pagination_failure"
  );
});

test("locked display shows the saved property without loading discovery", () => {
  assert.deepEqual(getGa4PropertyDisplayOptions({
    savedPropertyId: "413061668",
    savedPropertyLabel: "Store — Analytics Account (413061668)",
    discoveredProperties: [],
    locked: true,
  }), [{
    value: "413061668",
    label: "Store — Analytics Account (413061668)",
  }]);
});

test("saved property display falls back to its property ID", () => {
  assert.deepEqual(getSavedGa4PropertyOption("413061668"), {
    value: "413061668",
    label: "GA4 Property (413061668)",
  });
});

test("empty GA4 message is used only when no saved property exists", () => {
  assert.equal(
    getGa4EmptyOptionText(false),
    "No GA4 properties found or API access pending"
  );
  assert.equal(getGa4EmptyOptionText(true), "Select GA4 Property");
});

test("unlocked reconnect uses only freshly discovered properties", () => {
  const fresh = [{ value: "200", label: "Fresh (200)" }];
  assert.deepEqual(getGa4PropertyDisplayOptions({
    savedPropertyId: "100",
    savedPropertyLabel: "Stale (100)",
    discoveredProperties: fresh,
    locked: false,
  }), fresh);
});

test("configured API secret uses the connected green title", () => {
  assert.equal(isGa4ApiSecretConfigured("configured"), true);
  assert.equal(getGa4ApiSecretTitleColor(true), "#15803d");
});

test("missing API secret keeps the default title color", () => {
  assert.equal(isGa4ApiSecretConfigured("not_configured"), false);
  assert.equal(getGa4ApiSecretTitleColor(false), undefined);
});

test("blank secret retention remains configured from backend status", () => {
  const submittedSecret = "";
  const configuredAfterSave =
    Boolean(submittedSecret) || isGa4ApiSecretConfigured("configured");
  assert.equal(configuredAfterSave, true);
});
