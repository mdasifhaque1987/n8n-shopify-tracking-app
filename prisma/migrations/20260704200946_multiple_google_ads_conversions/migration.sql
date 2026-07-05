-- DropIndex
DROP INDEX IF EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_e_key";

-- RenameIndex
ALTER INDEX IF EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_conve" RENAME TO "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_c_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_event" RENAME TO "GoogleAdsConversionAction_workspaceId_googleAdsCustomerId_e_idx";
