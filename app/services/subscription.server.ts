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

export type SubscriptionEntitlements = {
  canonicalPlan: "core-starter" | "core-server";
  subscriptionVerified: boolean;
  googleClientSide: boolean;
  metaClientSide: boolean;
  googleAdsServerSide: boolean;
  ga4ServerSide: boolean;
  metaCapi: boolean;
};

const LEAST_PRIVILEGED_ENTITLEMENTS: SubscriptionEntitlements = {
  canonicalPlan: "core-starter",
  subscriptionVerified: false,
  googleClientSide: true,
  metaClientSide: true,
  googleAdsServerSide: false,
  ga4ServerSide: false,
  metaCapi: false,
};

export function resolveSubscriptionEntitlements(input: {
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
}): SubscriptionEntitlements {
  const canonicalPlan = normalizeShopifyPlanHandle(input.subscriptionPlan);
  const subscriptionVerified =
    input.subscriptionStatus === "active" || input.subscriptionStatus === "trial";

  if (!subscriptionVerified || canonicalPlan !== "core-server") {
    return {
      ...LEAST_PRIVILEGED_ENTITLEMENTS,
      subscriptionVerified,
    };
  }

  return {
    canonicalPlan: "core-server",
    subscriptionVerified: true,
    googleClientSide: true,
    metaClientSide: true,
    googleAdsServerSide: true,
    ga4ServerSide: true,
    metaCapi: true,
  };
}

export async function getShopEntitlements(
  shop: string,
): Promise<SubscriptionEntitlements> {
  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: {
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });

  return resolveSubscriptionEntitlements({
    subscriptionPlan: settings?.subscriptionPlan,
    subscriptionStatus: settings?.subscriptionStatus,
  });
}

export async function removeServerSideSettings(shop: string): Promise<void> {
  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: { workspaceId: true },
  });

  if (!settings?.workspaceId) return;

  await db.$transaction([
    db.platformDeliverySetting.updateMany({
      where: { workspaceId: settings.workspaceId, serverSideEnabled: true },
      data: {
        serverSideEnabled: false,
        clientSideEnabled: true,
        deliveryMode: "client",
      },
    }),
    db.shopAssetSelection.updateMany({
      where: {
        workspaceId: settings.workspaceId,
        OR: [
          { assetType: { endsWith: ":server_side" }, assetValue: "true" },
          {
            platform: "meta",
            assetType: "Meta Server Side Enabled",
            assetValue: "true",
          },
        ],
      },
      data: { assetValue: "false", assetLabel: "Disabled" },
    }),
    db.googleAdsConversionAction.updateMany({
      where: { workspaceId: settings.workspaceId, deliveryMode: "server" },
      data: { deliveryMode: "client" },
    }),
  ]);
}

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

  const savedSubscription = await db.shopSettings.upsert({
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

  const entitlements = resolveSubscriptionEntitlements({
    subscriptionPlan,
    subscriptionStatus: safeStatus,
  });

  if (!entitlements.googleAdsServerSide) {
    await removeServerSideSettings(shop);
  }

  return savedSubscription;
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
