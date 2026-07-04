import db from "../db.server";

const TEST_MODE_PLATFORM = "app";
const TEST_MODE_ASSET_TYPE = "test_mode_enabled";

export type TestModeSettings = {
  enabled: boolean;
  value: "true" | "false";
  label: string;
};

function parseEnabled(value?: string | null) {
  return value === "true";
}

export async function getTestModeSettings(
  workspaceId: string,
): Promise<TestModeSettings> {
  const setting = await db.shopAssetSelection.findUnique({
    where: {
      workspaceId_platform_assetType: {
        workspaceId,
        platform: TEST_MODE_PLATFORM,
        assetType: TEST_MODE_ASSET_TYPE,
      },
    },
  });

  const enabled = parseEnabled(setting?.assetValue);

  return {
    enabled,
    value: enabled ? "true" : "false",
    label: enabled ? "Test Mode Active" : "Live Mode",
  };
}

export async function saveTestModeSettings(data: {
  workspaceId: string;
  enabled: boolean;
}) {
  const assetValue = data.enabled ? "true" : "false";
  const assetLabel = data.enabled ? "Test Mode Active" : "Live Mode";

  return db.shopAssetSelection.upsert({
    where: {
      workspaceId_platform_assetType: {
        workspaceId: data.workspaceId,
        platform: TEST_MODE_PLATFORM,
        assetType: TEST_MODE_ASSET_TYPE,
      },
    },
    update: {
      assetValue,
      assetLabel,
    },
    create: {
      workspaceId: data.workspaceId,
      platform: TEST_MODE_PLATFORM,
      assetType: TEST_MODE_ASSET_TYPE,
      assetValue,
      assetLabel,
    },
  });
}

export async function isTestModeEnabled(workspaceId?: string | null) {
  if (!workspaceId) {
    return false;
  }

  const settings = await getTestModeSettings(workspaceId);

  return settings.enabled;
}
