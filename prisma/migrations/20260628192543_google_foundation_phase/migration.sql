-- AlterTable
ALTER TABLE "GoogleAdsConversionAction" ADD COLUMN     "conversionId" TEXT,
ADD COLUMN     "conversionLabel" TEXT,
ADD COLUMN     "deliveryMode" TEXT NOT NULL DEFAULT 'server';

-- CreateTable
CREATE TABLE "PlatformDeliverySetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "clientSideEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serverSideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryMode" TEXT NOT NULL DEFAULT 'client',
    "testCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformDeliverySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformServerCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetName" TEXT,
    "accessToken" TEXT,
    "apiSecret" TEXT,
    "tokenStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "lastValidatedAt" TIMESTAMP(3),
    "testCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformServerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDeliveryLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "shop" TEXT,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'internal',
    "deliveryType" TEXT NOT NULL DEFAULT 'server',
    "status" TEXT NOT NULL,
    "message" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformDeliverySetting_workspaceId_idx" ON "PlatformDeliverySetting"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformDeliverySetting_workspaceId_platform_key" ON "PlatformDeliverySetting"("workspaceId", "platform");

-- CreateIndex
CREATE INDEX "PlatformServerCredential_workspaceId_idx" ON "PlatformServerCredential"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformServerCredential_workspaceId_platform_assetType_ass_key" ON "PlatformServerCredential"("workspaceId", "platform", "assetType", "assetId");

-- CreateIndex
CREATE INDEX "EventDeliveryLog_workspaceId_idx" ON "EventDeliveryLog"("workspaceId");

-- CreateIndex
CREATE INDEX "EventDeliveryLog_shop_idx" ON "EventDeliveryLog"("shop");

-- CreateIndex
CREATE INDEX "EventDeliveryLog_eventId_idx" ON "EventDeliveryLog"("eventId");

-- CreateIndex
CREATE INDEX "EventDeliveryLog_platform_idx" ON "EventDeliveryLog"("platform");

-- AddForeignKey
ALTER TABLE "PlatformDeliverySetting" ADD CONSTRAINT "PlatformDeliverySetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformServerCredential" ADD CONSTRAINT "PlatformServerCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDeliveryLog" ADD CONSTRAINT "EventDeliveryLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
