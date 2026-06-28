import db from "../db.server";

export async function saveGoogleAdsConversionAction(data: {
  workspaceId: string;
  googleAdsCustomerId: string;
  eventName: string;
  conversionName: string;
  conversionActionId?: string;
  conversionId?: string;
  conversionLabel?: string;
  resourceName: string;
  category?: string;
  reused?: boolean;
  deliveryMode?: "client" | "server";
}) {
  return db.googleAdsConversionAction.upsert({
    where: {
      workspaceId_googleAdsCustomerId_eventName: {
        workspaceId: data.workspaceId,
        googleAdsCustomerId: data.googleAdsCustomerId,
        eventName: data.eventName,
      },
    },
    update: {
      conversionName: data.conversionName,
      conversionActionId: data.conversionActionId,
      conversionId: data.conversionId,
      conversionLabel: data.conversionLabel,
      resourceName: data.resourceName,
      category: data.category,
      reused: Boolean(data.reused),
      deliveryMode: data.deliveryMode || "server",
      isActive: true,
    },
    create: {
      workspaceId: data.workspaceId,
      googleAdsCustomerId: data.googleAdsCustomerId,
      eventName: data.eventName,
      conversionName: data.conversionName,
      conversionActionId: data.conversionActionId,
      conversionId: data.conversionId,
      conversionLabel: data.conversionLabel,
      resourceName: data.resourceName,
      category: data.category,
      reused: Boolean(data.reused),
      deliveryMode: data.deliveryMode || "server",
      isActive: true,
    },
  });
}

export async function getGoogleAdsConversionActions(workspaceId: string) {
  return db.googleAdsConversionAction.findMany({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getGoogleAdsConversionActionForEvent(data: {
  workspaceId: string;
  googleAdsCustomerId: string;
  eventName: string;
}) {
  return db.googleAdsConversionAction.findUnique({
    where: {
      workspaceId_googleAdsCustomerId_eventName: {
        workspaceId: data.workspaceId,
        googleAdsCustomerId: data.googleAdsCustomerId,
        eventName: data.eventName,
      },
    },
  });
}
