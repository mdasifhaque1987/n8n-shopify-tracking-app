import db from "../db.server";
import {
  getPlanDefinition,
  normalizeShopifyPlanHandle,
} from "../config/pricing-plans";

export type StoredSubscriptionStatus =
  | "unverified"
  | "pending_verification"
  | "active"
  | "trial"
  | "inactive"
  | "unknown_plan"
  | "verification_error";

type RecordPlanRedirectInput = {
  shop: string;
  shopifyPlanHandle: string;
};

type SaveVerifiedSubscriptionInput = {
  shop: string;
  shopifyShopGid: string;
  shopifyPlanHandle: string | null;
  status: "active" | "trial" | "inactive";
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
};

export async function recordPlanRedirect({
  shop,
  shopifyPlanHandle,
}: RecordPlanRedirectInput) {
  const subscriptionPlan =
    normalizeShopifyPlanHandle(shopifyPlanHandle);

  const subscriptionStatus: StoredSubscriptionStatus =
    subscriptionPlan
      ? "pending_verification"
      : "unknown_plan";

  return db.shopSettings.upsert({
    where: {
      shop,
    },
    update: {
      shopifyPlanHandle,
      subscriptionPlan,
      subscriptionStatus,
    },
    create: {
      shop,
      shopifyPlanHandle,
      subscriptionPlan,
      subscriptionStatus,
    },
  });
}

export async function saveVerifiedSubscription({
  shop,
  shopifyShopGid,
  shopifyPlanHandle,
  status,
  trialEndsAt = null,
  currentPeriodEnd = null,
}: SaveVerifiedSubscriptionInput) {
  const subscriptionPlan =
    normalizeShopifyPlanHandle(shopifyPlanHandle);

  const safeStatus: StoredSubscriptionStatus =
    status === "active" || status === "trial"
      ? subscriptionPlan
        ? status
        : "unknown_plan"
      : "inactive";

  return db.shopSettings.upsert({
    where: {
      shop,
    },
    update: {
      shopifyShopGid,
      shopifyPlanHandle,
      subscriptionPlan,
      subscriptionStatus: safeStatus,
      subscriptionVerifiedAt: new Date(),
      subscriptionTrialEndsAt: trialEndsAt,
      subscriptionCurrentPeriodEnd: currentPeriodEnd,
    },
    create: {
      shop,
      shopifyShopGid,
      shopifyPlanHandle,
      subscriptionPlan,
      subscriptionStatus: safeStatus,
      subscriptionVerifiedAt: new Date(),
      subscriptionTrialEndsAt: trialEndsAt,
      subscriptionCurrentPeriodEnd: currentPeriodEnd,
    },
  });
}

export async function saveSubscriptionVerificationError(
  shop: string,
) {
  return db.shopSettings.upsert({
    where: {
      shop,
    },
    update: {
      subscriptionStatus: "verification_error",
      subscriptionVerifiedAt: new Date(),
    },
    create: {
      shop,
      subscriptionStatus: "verification_error",
      subscriptionVerifiedAt: new Date(),
    },
  });
}

export async function getShopSubscription(shop: string) {
  const settings = await db.shopSettings.findUnique({
    where: {
      shop,
    },
    select: {
      shopifyShopGid: true,
      shopifyPlanHandle: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionVerifiedAt: true,
      subscriptionTrialEndsAt: true,
      subscriptionCurrentPeriodEnd: true,
    },
  });

  const plan = getPlanDefinition(settings?.subscriptionPlan);

  const isVerifiedAndActive =
    settings?.subscriptionStatus === "active" ||
    settings?.subscriptionStatus === "trial";

  return {
    shopifyShopGid: settings?.shopifyShopGid || null,
    shopifyPlanHandle: settings?.shopifyPlanHandle || null,
    subscriptionPlan: settings?.subscriptionPlan || null,
    subscriptionStatus:
      settings?.subscriptionStatus || "unverified",
    subscriptionVerifiedAt:
      settings?.subscriptionVerifiedAt || null,
    subscriptionTrialEndsAt:
      settings?.subscriptionTrialEndsAt || null,
    subscriptionCurrentPeriodEnd:
      settings?.subscriptionCurrentPeriodEnd || null,

    plan,
    hasActiveSubscription: isVerifiedAndActive,
    clientSideEnabled:
      isVerifiedAndActive && Boolean(plan?.clientSide),
    serverSideEnabled:
      isVerifiedAndActive && Boolean(plan?.serverSide),

    platforms: {
      google:
        isVerifiedAndActive &&
        Boolean(plan?.platforms.google),
      meta:
        isVerifiedAndActive &&
        Boolean(plan?.platforms.meta),
      tiktok:
        isVerifiedAndActive &&
        Boolean(plan?.platforms.tiktok),
      pinterest:
        isVerifiedAndActive &&
        Boolean(plan?.platforms.pinterest),
    },
  };
}
