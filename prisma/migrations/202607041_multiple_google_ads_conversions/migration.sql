-- Allow multiple Google Ads conversion actions for the same event.
-- Previous unique index forced one conversion per event/account.

ALTER TABLE "GoogleAdsConversionAction"
ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_eventName_key";

CREATE INDEX IF NOT EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_eventName_idx"
ON "GoogleAdsConversionAction"("workspaceId", "googleAdsCustomerId", "eventName");

CREATE INDEX IF NOT EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_conversionActionId_idx"
ON "GoogleAdsConversionAction"("workspaceId", "googleAdsCustomerId", "conversionActionId");
