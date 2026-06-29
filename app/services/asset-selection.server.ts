import db from "../db.server";

export async function saveAssetSelection(data: {
  workspaceId: string;
  platform: string;
  assetType: string;
  assetValue: string;
  assetLabel?: string;
}) {
  return db.shopAssetSelection.upsert({
    where: {
      workspaceId_platform_assetType: {
        workspaceId: data.workspaceId,
        platform: data.platform,
        assetType: data.assetType,
      },
    },
    update: {
      assetValue: data.assetValue,
      assetLabel: data.assetLabel,
    },
    create: {
      workspaceId: data.workspaceId,
      platform: data.platform,
      assetType: data.assetType,
      assetValue: data.assetValue,
      assetLabel: data.assetLabel,
    },
  });
}

export async function getAssetSelections(workspaceId: string) {
  const rows = await db.shopAssetSelection.findMany({
    where: { workspaceId },
  });

  const selections: Record<string, string> = {};

  for (const row of rows) {
    selections[`${row.platform}:${row.assetType}`] = row.assetValue;
  }

  return selections;
}
