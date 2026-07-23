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

export async function getAssetSelectionLabels(workspaceId: string) {
  const rows = await db.shopAssetSelection.findMany({
    where: { workspaceId },
    select: {
      platform: true,
      assetType: true,
      assetLabel: true,
    },
  });

  const labels: Record<string, string> = {};

  for (const row of rows) {
    if (row.assetLabel) {
      labels[`${row.platform}:${row.assetType}`] = row.assetLabel;
    }
  }

  return labels;
}

export async function deleteAssetSelection(data: {
  workspaceId: string;
  platform: string;
  assetType: string;
}) {
  return db.shopAssetSelection.deleteMany({ where: data });
}
