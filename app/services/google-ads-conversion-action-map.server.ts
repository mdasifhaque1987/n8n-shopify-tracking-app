import db from "../db.server";

type SaveGoogleAdsConversionActionInput = {
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
  deliveryMode?: string;
  isPrimary?: boolean;
  existingRecordId?: string;
};

export async function saveGoogleAdsConversionAction(data: SaveGoogleAdsConversionActionInput) {
  const payload = {
    workspaceId: data.workspaceId,
    googleAdsCustomerId: String(data.googleAdsCustomerId || "").replace(/-/g, "").trim(),
    eventName: data.eventName,
    conversionName: data.conversionName,
    conversionActionId: data.conversionActionId,
    conversionId: data.conversionId,
    conversionLabel: data.conversionLabel,
    resourceName: data.resourceName,
    category: data.category,
    reused: Boolean(data.reused),
    deliveryMode: data.deliveryMode || "client",
    isPrimary: data.isPrimary !== false,
    isActive: true,
  };

  if (data.existingRecordId) {
    return db.googleAdsConversionAction.update({
      where: {
        id: data.existingRecordId,
      },
      data: payload,
    });
  }

  const existingByConversionActionId = payload.conversionActionId
    ? await db.googleAdsConversionAction.findFirst({
        where: {
          workspaceId: payload.workspaceId,
          googleAdsCustomerId: payload.googleAdsCustomerId,
          conversionActionId: payload.conversionActionId,
        },
      })
    : null;

  if (existingByConversionActionId) {
    return db.googleAdsConversionAction.update({
      where: {
        id: existingByConversionActionId.id,
      },
      data: payload,
    });
  }

  return db.googleAdsConversionAction.create({
    data: payload,
  });
}
