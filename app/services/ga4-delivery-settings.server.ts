import db from "../db.server";
import { encryptToken, decryptToken } from "../lib/encryption.server";

const PLATFORM = "GA4";

export async function saveGa4DeliverySettings(data: {
  workspaceId: string;
  measurementId: string;
  propertyId?: string;
  deliveryMode: "client" | "server";
  apiSecret?: string;
  testCode?: string;
}) {
  const serverMode = data.deliveryMode === "server";
  const assetName = data.propertyId || data.measurementId;

  const setting = await db.platformDeliverySetting.upsert({
    where: {
      workspaceId_platform: {
        workspaceId: data.workspaceId,
        platform: PLATFORM,
      },
    },
    update: {
      clientSideEnabled: data.deliveryMode === "client",
      serverSideEnabled: serverMode,
      deliveryMode: data.deliveryMode,
      testCode: data.testCode,
      isActive: true,
    },
    create: {
      workspaceId: data.workspaceId,
      platform: PLATFORM,
      clientSideEnabled: data.deliveryMode === "client",
      serverSideEnabled: serverMode,
      deliveryMode: data.deliveryMode,
      testCode: data.testCode,
      isActive: true,
    },
  });

  const credentialUpdate = {
    assetName,
    testCode: data.testCode,
    isActive: true,
    ...(serverMode && data.apiSecret
      ? {
          apiSecret: encryptToken(data.apiSecret),
          tokenStatus: "configured",
        }
      : {}),
  };

  const credential = await db.platformServerCredential.upsert({
    where: {
      workspaceId_platform_assetType_assetId: {
        workspaceId: data.workspaceId,
        platform: PLATFORM,
        assetType: "ga4_measurement",
        assetId: data.measurementId,
      },
    },
    update: credentialUpdate,
    create: {
      workspaceId: data.workspaceId,
      platform: PLATFORM,
      assetType: "ga4_measurement",
      assetId: data.measurementId,
      assetName,
      apiSecret: serverMode && data.apiSecret ? encryptToken(data.apiSecret) : null,
      tokenStatus: serverMode && data.apiSecret ? "configured" : "not_configured",
      testCode: data.testCode,
      isActive: true,
    },
  });

  return { setting, credential };
}

export async function getGa4DeliverySettings(workspaceId: string, includeSecret = false) {
  const setting = await db.platformDeliverySetting.findUnique({
    where: {
      workspaceId_platform: {
        workspaceId,
        platform: PLATFORM,
      },
    },
  });

  const credential = await db.platformServerCredential.findFirst({
    where: {
      workspaceId,
      platform: PLATFORM,
      assetType: "ga4_measurement",
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return {
    setting,
    credential: credential
      ? {
          ...credential,
          apiSecret:
            includeSecret && credential.apiSecret
              ? decryptToken(credential.apiSecret)
              : undefined,
        }
      : null,
  };
}
