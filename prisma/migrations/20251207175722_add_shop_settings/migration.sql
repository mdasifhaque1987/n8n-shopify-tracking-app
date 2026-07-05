-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopSettings" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "ga4Id" TEXT,
    "googleAdsId" TEXT,
    "facebookPixelId" TEXT,
    "tiktokPixelId" TEXT,
    "pinterestTagId" TEXT,
    "linkedinPid" TEXT,
    "bingUetTagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopSettings_shop_key" ON "ShopSettings"("shop");
