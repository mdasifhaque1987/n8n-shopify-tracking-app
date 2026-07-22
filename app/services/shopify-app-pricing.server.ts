import {
  saveSubscriptionVerificationError,
  saveVerifiedSubscription,
} from "./subscription.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

type VerifySubscriptionInput = {
  shop: string;
  admin: AdminGraphqlClient;
};

type PartnerSubscriptionResponse = {
  data?: {
    activeSubscription?: {
      billingPeriod: string;
      cancelAtEndOfCycle: boolean;
      trialEndsAt: string | null;
      currentBillingCycle: {
        startTime: string;
        endTime: string;
      } | null;
      items: Array<{
        handle: string;
        description: string | null;
        price: {
          __typename: string;
          active: boolean;
          currency: string;
          amount?: string;
        };
      }>;
    } | null;
  };
  errors?: Array<{
    message: string;
  }>;
};

class SubscriptionVerificationFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly category: string,
  ) {
    super(message);
    this.name = "SubscriptionVerificationFailure";
  }
}

function classifySubscriptionError(error: unknown) {
  if (error instanceof SubscriptionVerificationFailure) {
    return { retryable: error.retryable, category: error.category };
  }

  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";

  if (name === "AbortError") return { retryable: true, category: "subscription_timeout" };
  if (error instanceof TypeError) return { retryable: true, category: "subscription_network" };
  if (error instanceof Response) {
    return {
      retryable: error.status === 429 || error.status >= 500,
      category: error.status === 429
        ? "subscription_rate_limited"
        : error.status >= 500
          ? "subscription_service_unavailable"
          : "subscription_rejected",
    };
  }

  return { retryable: true, category: "subscription_unavailable" };
}

async function describeSubscriptionError(
  error: unknown,
): Promise<string> {
  if (error instanceof Response) {
    const statusDescription = [
      error.status || null,
      error.statusText || null,
    ]
      .filter(Boolean)
      .join(" ");

    return `Shopify request failed (${statusDescription || "unknown HTTP status"}).`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function getShopifyShopGid(
  admin: AdminGraphqlClient,
): Promise<string> {
  const response = await admin.graphql(`
    #graphql
    query SubscriptionShopId {
      shop {
        id
      }
    }
  `);

  const payload = (await response.json()) as {
    data?: {
      shop?: {
        id?: string;
      };
    };
    errors?: Array<{
      message: string;
    }>;
  };

  const shopGid = payload.data?.shop?.id;

  if (!shopGid) {
    const errorMessage =
      payload.errors?.map((error) => error.message).join("; ") ||
      "Shopify shop GID was not returned.";

    throw new Error(errorMessage);
  }

  return shopGid;
}

function getPartnerApiConfiguration() {
  const organizationId = String(
    process.env.SHOPIFY_PARTNER_ORGANIZATION_ID || "",
  ).trim();

  const accessToken = String(
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN || "",
  ).trim();

  const appId = String(
    process.env.SHOPIFY_PARTNER_APP_ID || "",
  ).trim();

  const apiVersion = String(
    process.env.SHOPIFY_PARTNER_API_VERSION || "2026-07",
  ).trim();

  return {
    organizationId,
    accessToken,
    appId,
    apiVersion,
    configured: Boolean(
      organizationId &&
        accessToken &&
        appId &&
        apiVersion,
    ),
  };
}

async function queryActiveSubscription(
  appId: string,
  shopId: string,
) {
  const configuration = getPartnerApiConfiguration();

  if (!configuration.configured) {
    return {
      configured: false as const,
      activeSubscription: null,
    };
  }

  const endpoint =
    `https://partners.shopify.com/` +
    `${encodeURIComponent(configuration.organizationId)}` +
    `/api/${encodeURIComponent(configuration.apiVersion)}` +
    `/graphql.json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token":
          configuration.accessToken,
      },
      body: JSON.stringify({
        query: `
          query ActiveSubscription(
            $appId: ID!
            $shopId: ID!
          ) {
            activeSubscription(
              appId: $appId
              shopId: $shopId
            ) {
              billingPeriod
              cancelAtEndOfCycle
              trialEndsAt

              currentBillingCycle {
                startTime
                endTime
              }

              items {
                handle
                description

                price {
                  __typename
                  active
                  currency

                  ... on FlatRatePrice {
                    amount
                  }
                }
              }
            }
          }
        `,
        variables: {
          appId,
          shopId,
        },
      }),
      signal: controller.signal,
    });

    const payload =
      (await response.json()) as PartnerSubscriptionResponse;

    if (!response.ok) {
      throw new SubscriptionVerificationFailure(
        `Partner API request failed with HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        response.status === 429
          ? "subscription_rate_limited"
          : response.status >= 500
            ? "subscription_service_unavailable"
            : "subscription_rejected",
      );
    }

    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) => error.message)
          .join("; "),
      );
    }

    return {
      configured: true as const,
      activeSubscription:
        payload.data?.activeSubscription || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyShopifyAppPricingSubscription({
  shop,
  admin,
}: VerifySubscriptionInput) {
  const configuration = getPartnerApiConfiguration();

  if (!configuration.configured) {
    return {
      ok: false,
      configured: false,
      status: "pending_verification" as const,
      message:
        "Partner API credentials are not configured yet.",
      retryable: false,
      errorCategory: "subscription_verifier_not_configured",
    };
  }

  try {
    const shopifyShopGid =
      await getShopifyShopGid(admin);

    const result = await queryActiveSubscription(
      configuration.appId,
      shopifyShopGid,
    );

    const subscription = result.activeSubscription;

    if (!subscription) {
      await saveVerifiedSubscription({
        shop,
        shopifyShopGid,
        shopifyPlanHandle: null,
        status: "inactive",
        trialEndsAt: null,
        currentPeriodEnd: null,
      });

      return {
        ok: true,
        configured: true,
        status: "inactive" as const,
        planHandle: null,
        message:
          "No active Shopify App Pricing subscription was found.",
        retryable: false,
        errorCategory: null,
      };
    }

    const activePlanItem =
      subscription.items.find(
        (item) => item.price?.active,
      ) || subscription.items[0];

    const shopifyPlanHandle =
      activePlanItem?.handle || null;

    const trialEndsAt = subscription.trialEndsAt
      ? new Date(subscription.trialEndsAt)
      : null;

    const currentPeriodEnd =
      subscription.currentBillingCycle?.endTime
        ? new Date(
            subscription.currentBillingCycle.endTime,
          )
        : null;

    const isTrial =
      Boolean(trialEndsAt) &&
      trialEndsAt!.getTime() > Date.now();

    await saveVerifiedSubscription({
      shop,
      shopifyShopGid,
      shopifyPlanHandle,
      status: isTrial ? "trial" : "active",
      trialEndsAt,
      currentPeriodEnd,
    });

    return {
      ok: true,
      configured: true,
      status: isTrial
        ? ("trial" as const)
        : ("active" as const),
      planHandle: shopifyPlanHandle,
      message: isTrial
        ? "The Shopify subscription trial is active."
        : "The Shopify subscription is active.",
      retryable: false,
      errorCategory: null,
    };
  } catch (error) {
    const classification = classifySubscriptionError(error);
    const message =
      await describeSubscriptionError(error);

    console.error(
      "Shopify App Pricing verification failed",
      {
        shop,
        message,
      },
    );

    if (!classification.retryable) {
      await saveSubscriptionVerificationError(shop);
    }

    return {
      ok: false,
      configured: true,
      status: "verification_error" as const,
      planHandle: null,
      message,
      retryable: classification.retryable,
      errorCategory: classification.category,
    };
  }
}
