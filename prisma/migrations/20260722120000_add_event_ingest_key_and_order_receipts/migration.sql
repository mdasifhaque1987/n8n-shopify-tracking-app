ALTER TABLE "ShopSettings"
ADD COLUMN "eventIngestKeyHash" TEXT;

CREATE UNIQUE INDEX "ShopSettings_eventIngestKeyHash_key"
ON "ShopSettings"("eventIngestKeyHash");

CREATE TABLE "ShopifyOrderJob" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "webhookId" TEXT,
  "orderSnapshot" JSONB NOT NULL,
  "encryptedCustomerData" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "lastErrorCategory" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopifyOrderJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopifyOrderJob_shop_orderId_key"
ON "ShopifyOrderJob"("shop", "orderId");

CREATE INDEX "ShopifyOrderJob_status_nextAttemptAt_idx"
ON "ShopifyOrderJob"("status", "nextAttemptAt");

CREATE INDEX "ShopifyOrderJob_lockedAt_idx"
ON "ShopifyOrderJob"("lockedAt");

CREATE TABLE "ShopifyOrderPlatformDelivery" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "lastErrorCategory" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopifyOrderPlatformDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShopifyOrderPlatformDelivery"
ADD CONSTRAINT "ShopifyOrderPlatformDelivery_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "ShopifyOrderJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ShopifyOrderPlatformDelivery_shop_orderId_platform_key"
ON "ShopifyOrderPlatformDelivery"("shop", "orderId", "platform");

CREATE INDEX "ShopifyOrderPlatformDelivery_jobId_status_nextAttemptAt_idx"
ON "ShopifyOrderPlatformDelivery"("jobId", "status", "nextAttemptAt");

CREATE INDEX "ShopifyOrderPlatformDelivery_lockedAt_idx"
ON "ShopifyOrderPlatformDelivery"("lockedAt");
