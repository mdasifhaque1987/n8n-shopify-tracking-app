-- CreateTable
CREATE TABLE "GoogleConversionConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "setupType" TEXT NOT NULL,
    "conversionName" TEXT,
    "conversionValueMode" TEXT NOT NULL DEFAULT 'dynamic',
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConversionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleConversionConfig_workspaceId_idx" ON "GoogleConversionConfig"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConversionConfig_workspaceId_googleAdsCustomerId_key" ON "GoogleConversionConfig"("workspaceId", "googleAdsCustomerId");

-- AddForeignKey
ALTER TABLE "GoogleConversionConfig" ADD CONSTRAINT "GoogleConversionConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
