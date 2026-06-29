-- CreateTable
CREATE TABLE "GoogleAdsConversionAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "conversionName" TEXT NOT NULL,
    "conversionActionId" TEXT,
    "resourceName" TEXT NOT NULL,
    "category" TEXT,
    "reused" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConversionAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleAdsConversionAction_workspaceId_idx" ON "GoogleAdsConversionAction"("workspaceId");

-- CreateIndex
CREATE INDEX "GoogleAdsConversionAction_googleAdsCustomerId_idx" ON "GoogleAdsConversionAction"("googleAdsCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_e_key" ON "GoogleAdsConversionAction"("workspaceId", "googleAdsCustomerId", "eventName");

-- AddForeignKey
ALTER TABLE "GoogleAdsConversionAction" ADD CONSTRAINT "GoogleAdsConversionAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
