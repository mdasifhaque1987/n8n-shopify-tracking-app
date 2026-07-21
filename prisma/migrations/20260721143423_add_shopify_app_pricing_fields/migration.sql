ALTER TABLE "ShopSettings"
ADD COLUMN "shopifyShopGid" TEXT,
ADD COLUMN "shopifyPlanHandle" TEXT,
ADD COLUMN "subscriptionPlan" TEXT,
ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN "subscriptionVerifiedAt" TIMESTAMP(3),
ADD COLUMN "subscriptionTrialEndsAt" TIMESTAMP(3),
ADD COLUMN "subscriptionCurrentPeriodEnd" TIMESTAMP(3);
