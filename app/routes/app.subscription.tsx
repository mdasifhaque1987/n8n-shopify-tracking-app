import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getShopSubscription } from "../services/subscription.server";
import {
  verifyShopifyAppPricingSubscription,
} from "../services/shopify-app-pricing.server";

function getStoreHandle(shop: string) {
  return shop.replace(
    /\.myshopify\.com$/i,
    "",
  );
}

function formatDate(
  value: string | Date | null | undefined,
) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Active",
    trial: "Trial active",
    inactive: "Inactive",
    unverified: "Not verified",
    pending_verification: "Verification pending",
    unknown_plan: "Unknown plan",
    verification_error: "Verification error",
  };

  return labels[status] || status;
}

export async function loader({
  request,
}: LoaderFunctionArgs) {
  const { session, admin } =
    await authenticate.admin(request);

  const verification =
    await verifyShopifyAppPricingSubscription({
      shop: session.shop,
      admin,
    });

  const subscription =
    await getShopSubscription(session.shop);

  const url = new URL(request.url);
  const navParams = new URLSearchParams();

  navParams.set("shop", session.shop);

  for (const key of [
    "host",
    "embedded",
    "locale",
  ]) {
    const value = url.searchParams.get(key);

    if (value) {
      navParams.set(key, value);
    }
  }

  const appHandle = String(
    process.env.SHOPIFY_ADMIN_APP_HANDLE ||
      "home-39",
  ).trim();

  const storeHandle =
    getStoreHandle(session.shop);

  const pricingUrl =
    `https://admin.shopify.com/store/` +
    `${encodeURIComponent(storeHandle)}/` +
    `charges/${encodeURIComponent(appHandle)}/` +
    `pricing_plans`;

  return {
    shop: session.shop,
    navQuery: navParams.toString(),
    subscription,
    verification,
    pricingUrl,
    appHandle,
  };
}

export default function SubscriptionPage() {
  const {
    subscription,
    verification,
    pricingUrl,
    navQuery,
  } = useLoaderData<typeof loader>();

  const appPath = (path: string) => {
    const [basePath, existingQuery = ""] =
      path.split("?");

    const params =
      new URLSearchParams(existingQuery);

    const navigationParams =
      new URLSearchParams(navQuery);

    navigationParams.forEach(
      (value, key) => {
        if (!params.has(key)) {
          params.set(key, value);
        }
      },
    );

    const query = params.toString();

    return query
      ? `${basePath}?${query}`
      : basePath;
  };

  const active = Boolean(
    subscription.hasActiveSubscription,
  );

  const storedPlanName =
    subscription.plan?.displayName || "";

  const planName =
    active && storedPlanName
      ? storedPlanName
      : "No active plan";

  const monthlyPrice =
    active
      ? subscription.plan?.monthlyPriceUsd
      : undefined;

  const status =
    String(subscription.subscriptionStatus);

  const isStarter =
    subscription.subscriptionPlan ===
    "core-starter";

  const primaryActionLabel = !active
    ? "Choose a Plan"
    : isStarter
      ? "Upgrade or Change Plan"
      : "Downgrade or Change Plan";

  const statusColors =
    status === "active" || status === "trial"
      ? {
          color: "#166534",
          background: "#dcfce7",
          border: "#86efac",
        }
      : status === "verification_error"
        ? {
            color: "#991b1b",
            background: "#fee2e2",
            border: "#fecaca",
          }
        : {
            color: "#92400e",
            background: "#fef3c7",
            border: "#fde68a",
          };

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <section
        style={{
          padding: 28,
          borderRadius: 18,
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                color: "#111827",
              }}
            >
              My Subscription
            </h1>

            <p
              style={{
                margin: "10px 0 0",
                color: "#4b5563",
                lineHeight: 1.6,
              }}
            >
              View your current plan, tracking
              permissions, billing status, and
              available subscription actions.
            </p>
          </div>

          <span
            style={{
              display: "inline-flex",
              padding: "8px 13px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              color: statusColors.color,
              background: statusColors.background,
              border:
                `1px solid ${statusColors.border}`,
            }}
          >
            {getStatusLabel(status)}
          </span>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div style={styles.card}>
          <span style={styles.label}>
            Current plan
          </span>

          <strong style={styles.value}>
            {planName}
          </strong>

          <span style={styles.description}>
            {typeof monthlyPrice === "number"
              ? `$${monthlyPrice}/month`
              : storedPlanName
                ? `Previously selected: ${storedPlanName}. Shopify verification is required before activation.`
                : "Select a plan to activate tracking."}
          </span>
        </div>

        <div style={styles.card}>
          <span style={styles.label}>
            Client-side tracking
          </span>

          <strong style={styles.value}>
            {subscription.clientSideEnabled
              ? "Included"
              : "Not active"}
          </strong>

          <span style={styles.description}>
            Browser and Shopify Customer Events
            pixel delivery.
          </span>
        </div>

        <div style={styles.card}>
          <span style={styles.label}>
            Server-side tracking
          </span>

          <strong style={styles.value}>
            {subscription.serverSideEnabled
              ? "Included"
              : "Not included"}
          </strong>

          <span style={styles.description}>
            Backend delivery to supported
            advertising and analytics platforms.
          </span>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.heading}>
          Plan access
        </h2>

        <div style={styles.accessGrid}>
          <div style={styles.accessItem}>
            <span>Google tracking</span>
            <strong>
              {subscription.platforms.google
                ? "Available"
                : "Unavailable"}
            </strong>
          </div>

          <div style={styles.accessItem}>
            <span>Meta tracking</span>
            <strong>
              {subscription.platforms.meta
                ? "Available"
                : "Unavailable"}
            </strong>
          </div>

          <div style={styles.accessItem}>
            <span>TikTok tracking</span>
            <strong>
              {subscription.platforms.tiktok
                ? "Available"
                : "Not included"}
            </strong>
          </div>

          <div style={styles.accessItem}>
            <span>Pinterest tracking</span>
            <strong>
              {subscription.platforms.pinterest
                ? "Available"
                : "Not included"}
            </strong>
          </div>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.heading}>
          Billing details
        </h2>

        <div style={styles.detailsGrid}>
          <div>
            <span style={styles.label}>
              Subscription status
            </span>
            <strong style={styles.detailValue}>
              {getStatusLabel(status)}
            </strong>
          </div>

          <div>
            <span style={styles.label}>
              Trial ends
            </span>
            <strong style={styles.detailValue}>
              {formatDate(
                subscription.subscriptionTrialEndsAt,
              )}
            </strong>
          </div>

          <div>
            <span style={styles.label}>
              Current billing period ends
            </span>
            <strong style={styles.detailValue}>
              {formatDate(
                subscription.subscriptionCurrentPeriodEnd,
              )}
            </strong>
          </div>

          <div>
            <span style={styles.label}>
              Last verified
            </span>
            <strong style={styles.detailValue}>
              {formatDate(
                subscription.subscriptionVerifiedAt,
              )}
            </strong>
          </div>
        </div>
      </section>

      {verification.message && (
        <section
          style={{
            ...styles.panel,
            borderColor: verification.ok
              ? "#bbf7d0"
              : "#fecaca",
            background: verification.ok
              ? "#f0fdf4"
              : "#fef2f2",
          }}
        >
          <strong
            style={{
              color: verification.ok
                ? "#166534"
                : "#991b1b",
            }}
          >
            Subscription verification
          </strong>

          <p
            style={{
              margin: "8px 0 0",
              color: verification.ok
                ? "#166534"
                : "#991b1b",
              lineHeight: 1.6,
            }}
          >
            {verification.message}
          </p>
        </section>
      )}

      <section style={styles.actionsPanel}>
        <div>
          <h2 style={styles.heading}>
            Subscription actions
          </h2>

          <p
            style={{
              margin: "6px 0 0",
              color: "#4b5563",
              lineHeight: 1.6,
            }}
          >
            Shopify securely manages plan
            approval, billing, upgrades,
            downgrades, and cancellation.
          </p>
        </div>

        <div className="dh-button-row">
          <a
            href={pricingUrl}
            target="_top"
            rel="noreferrer"
            className="dh-button dh-button--active"
          >
            {primaryActionLabel}
          </a>

          {active && (
            <a
              href={pricingUrl}
              target="_top"
              rel="noreferrer"
              className="dh-button dh-button--danger"
            >
              Manage or Cancel in Shopify
            </a>
          )}

          <Link
            to={appPath(
              "/app/subscription?refresh=1",
            )}
            className="dh-button"
          >
            Refresh Subscription Status
          </Link>

          <Link
            to={appPath("/app/home")}
            className="dh-button"
          >
            Back to Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}

const styles = {
  card: {
    display: "grid",
    gap: 8,
    padding: 20,
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  },
  label: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  value: {
    color: "#111827",
    fontSize: 22,
  },
  description: {
    color: "#4b5563",
    fontSize: 13,
    lineHeight: 1.5,
  },
  panel: {
    padding: 20,
    marginBottom: 18,
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  },
  heading: {
    margin: 0,
    color: "#111827",
    fontSize: 18,
  },
  accessGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 12,
    marginTop: 16,
  },
  accessItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    background: "#f9fafb",
    borderRadius: 8,
    color: "#374151",
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 18,
    marginTop: 16,
  },
  detailValue: {
    display: "block",
    marginTop: 6,
    color: "#111827",
  },
  actionsPanel: {
    display: "grid",
    gap: 18,
    padding: 20,
    background: "#f9fafb",
    border: "1px solid #d1d5db",
    borderRadius: 12,
  },
  primaryButton: {
    display: "inline-flex",
    padding: "10px 16px",
    background: "#2563eb",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700,
  },
  dangerButton: {
    display: "inline-flex",
    padding: "10px 16px",
    background: "#dc2626",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700,
  },
  secondaryButton: {
    display: "inline-flex",
    padding: "10px 16px",
    background: "white",
    color: "#111827",
    border: "1px solid #d1d5db",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700,
  },
};
