-- CreateTable
CREATE TABLE "ShopAssetSelection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "assetValue" TEXT NOT NULL,
    "assetLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopAssetSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopAssetSelection_workspaceId_idx" ON "ShopAssetSelection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopAssetSelection_workspaceId_platform_assetType_key" ON "ShopAssetSelection"("workspaceId", "platform", "assetType");

-- AddForeignKey
ALTER TABLE "ShopAssetSelection" ADD CONSTRAINT "ShopAssetSelection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
