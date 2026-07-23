-- AlterTable
ALTER TABLE "ShopifyOrderJob"
ADD COLUMN "encryptedTrackingIdentity" TEXT;

-- CreateTable
CREATE TABLE "ShopifyCheckoutCorrelation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "checkoutTokenHash" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyCheckoutCorrelation_pkey"
    PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyCheckoutCorrelation_expiresAt_idx"
ON "ShopifyCheckoutCorrelation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyCheckoutCorrelation_shop_checkoutTokenHash_key"
ON "ShopifyCheckoutCorrelation"("shop", "checkoutTokenHash");
