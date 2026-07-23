ALTER TABLE "ShopSettings"
  ADD COLUMN "encryptedEventIngestKey" TEXT,
  ADD COLUMN "webPixelId" TEXT,
  ADD COLUMN "webPixelSyncedAt" TIMESTAMP(3),
  ADD COLUMN "webPixelSyncError" TEXT;

ALTER TABLE "ShopifyOrderPlatformDelivery"
  ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "testModeSource" TEXT NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN "testMechanism" TEXT NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "validationOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "encryptedTestCode" TEXT;
