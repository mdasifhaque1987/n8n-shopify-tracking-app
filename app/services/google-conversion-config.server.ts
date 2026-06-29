import db from "../db.server";

export async function saveGoogleConversionConfig(data: {
  workspaceId: string;
  googleAdsCustomerId: string;
  setupType: string;
  conversionName?: string;
  conversionValueMode: string;
  events: string[];
}) {
  return db.googleConversionConfig.upsert({
    where: {
      workspaceId_googleAdsCustomerId: {
        workspaceId: data.workspaceId,
        googleAdsCustomerId: data.googleAdsCustomerId,
      },
    },
    update: {
      setupType: data.setupType,
      conversionName: data.conversionName,
      conversionValueMode: data.conversionValueMode,
      events: data.events,
      isActive: true,
    },
    create: {
      workspaceId: data.workspaceId,
      googleAdsCustomerId: data.googleAdsCustomerId,
      setupType: data.setupType,
      conversionName: data.conversionName,
      conversionValueMode: data.conversionValueMode,
      events: data.events,
      isActive: true,
    },
  });
}
