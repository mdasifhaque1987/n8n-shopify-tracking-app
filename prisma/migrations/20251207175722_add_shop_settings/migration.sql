-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "ga4Id" TEXT,
    "googleAdsId" TEXT,
    "facebookPixelId" TEXT,
    "tiktokPixelId" TEXT,
    "pinterestTagId" TEXT,
    "linkedinPid" TEXT,
    "bingUetTagId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
