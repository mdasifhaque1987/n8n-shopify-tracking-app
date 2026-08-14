import { Link, Form, redirect, useLoaderData, useLocation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import {
  deactivateConnection,
  getWorkspaceConnections,
} from "../services/platform-connection.server";
import { getTestModeSettings } from "../services/test-mode.server";
import { getShopSubscription } from "../services/subscription.server";
import db from "../db.server";
import SubscriptionButton from "../components/SubscriptionButton";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const testModeSettings = await getTestModeSettings(workspace.id);
  const savedConnections = await getWorkspaceConnections(workspace.id);
  const subscription = await getShopSubscription(session.shop);

  const getStatus = (platform: string) => {
    const connection = savedConnections.find(
      (item) => item.platform === platform && item.isActive
    );

    return {
      id: connection?.id || null,
      connected: Boolean(connection),
      accountName: connection?.accountName || connection?.accountId || null,
    };
  };

  const url = new URL(request.url);
  const navParams = new URLSearchParams();
  const host = url.searchParams.get("host");
  const embedded = url.searchParams.get("embedded");
  const locale = url.searchParams.get("locale");

  navParams.set("shop", session.shop);
  if (host) navParams.set("host", host);
  if (embedded) navParams.set("embedded", embedded);
  if (locale) navParams.set("locale", locale);

  return {
    testModeSettings,
    subscription,
    shop: session.shop,
    navQuery: navParams.toString(),
    customerEnrichment: {
      enabled: process.env.SHOPIFY_ORDER_ENRICHMENT_ENABLED === "true",
    },
    connections: {
      google: getStatus("GOOGLE_ADS"),
      meta: getStatus("META"),
      tiktok: getStatus("TIKTOK"),
      pinterest: getStatus("PINTEREST"),
      microsoft: getStatus("MICROSOFT_ADS"),
      linkedin: getStatus("LINKEDIN"),
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);

  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId") || "");

  if (connectionId) {
    const connection = await db.platformConnection.findFirst({
      where: {
        id: connectionId,
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        platform: true,
      },
    });

    if (connection) {
      await deactivateConnection(connection.id);

      const normalizedPlatform =
        String(connection.platform || "")
          .toUpperCase();

      const assetPlatform =
        normalizedPlatform === "GOOGLE_ADS" ||
        normalizedPlatform === "GOOGLE"
          ? "google"
          : normalizedPlatform === "META"
            ? "meta"
            : normalizedPlatform === "TIKTOK"
              ? "tiktok"
              : normalizedPlatform === "PINTEREST"
                ? "pinterest"
                : normalizedPlatform ===
                    "MICROSOFT_ADS"
                  ? "microsoft"
                  : normalizedPlatform ===
                      "LINKEDIN"
                    ? "linkedin"
                    : null;

      if (assetPlatform) {
        await db.shopAssetSelection.deleteMany({
          where: {
            workspaceId: workspace.id,
            platform: assetPlatform,
          },
        });
      }
    }
  }

  return redirect(`/app/connections?shop=${encodeURIComponent(session.shop)}`);
}

export default function ConnectionsPage() {
  const {
    shop,
    connections,
    customerEnrichment,
    testModeSettings,
    subscription,
  } = useLoaderData<typeof loader>();
  const testModeEnabled = Boolean(testModeSettings?.enabled);
  const location = useLocation();
  const withNav = (path: string) => {
    const params = new URLSearchParams(location.search);
    if (!params.get("shop")) params.set("shop", shop);
    return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
  };
  const platforms = [
    {
      id: "google",
      name: "Google",
      description: "Connect Google Analytics, Google Ads, and Google Merchant Center",
      logo: "/assets/logos/platforms/google.svg",
      oauthUrl: `/api/oauth/google-init?shop=${encodeURIComponent(shop)}`,
    },
    {
      id: "meta",
      name: "Meta (Facebook)",
      description: "Connect Facebook Pixel, Instagram, and Meta Business",
      logo: "/assets/logos/platforms/meta.svg",
      oauthUrl: `/api/oauth/meta-init?shop=${encodeURIComponent(shop)}`,
    },
    {
      id: "tiktok",
      name: "TikTok",
      description: "Connect TikTok Pixel and TikTok Ads",
      logo: "/assets/logos/platforms/tiktok.svg",
      oauthUrl: `/api/oauth/tiktok-init?shop=${encodeURIComponent(shop)}`,
    },
    {
      id: "pinterest",
      name: "Pinterest",
      description: "Connect Pinterest Tag and Pinterest Ads",
      logo: "/assets/logos/platforms/pinterest.svg",
      oauthUrl: `/api/oauth/pinterest-init?shop=${encodeURIComponent(shop)}`,
    },
    {
      id: "microsoft",
      name: "Microsoft Ads",
      description: "Connect Bing UET and Microsoft Advertising",
      logo: "/assets/logos/platforms/microsoft.svg",
      oauthUrl: `/api/oauth/microsoft-init?shop=${encodeURIComponent(shop)}`,
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      description: "Connect LinkedIn Insight Tag and LinkedIn Ads",
      logo: "/assets/logos/platforms/linkedin.svg",
      oauthUrl: `/api/oauth/linkedin-init?shop=${encodeURIComponent(shop)}`,
    },
  ];

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>

        <h1
          style={{
            ...styles.title,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 28,
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          <img
            src="/assets/logos/dh-logo.png"
            alt="DH Conversions"
            style={{
              height: 36,
              width: "auto",
              maxWidth: 96,
              objectFit: "contain",
              display: "block",
              flexShrink: 0,
            }}
          />
          <span>Platform Connections</span>
        </h1>
        {testModeEnabled && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              width: "fit-content",
              marginTop: 12,
              borderRadius: 999,
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#9a3412",
              background: "#fed7aa",
              border: "1px solid #fdba74",
            }}
          >
            TEST MODE ACTIVE
          </div>
        )}
      </div>

      <p style={{ marginBottom: 24, color: "#666" }}>
        Connect, reconnect, or disconnect advertising platforms used for tracking and catalog sync.
      </p>

      <div className="dh-button-row" style={{ marginBottom: 24 }}>
        <Link to={withNav("/app/settings")} className="dh-button">
          Configuration
        </Link>

        <Link to={withNav("/app/delivery-logs")} className="dh-button">
          Event Delivery Logs
        </Link>

        <Link to={withNav("/app/help")} className="dh-button">
          Help / Documentation
        </Link>

        <SubscriptionButton
          subscription={subscription}
          to={withNav("/app/subscription")}
        />
      </div>

      {customerEnrichment.enabled && (
        <div
          style={{
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            backgroundColor: "#f0fdf4",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px",
              color: "#166534",
            }}
          >
            ✅ Customer enrichment enabled
          </h3>

          <p
            style={{
              margin: "0 0 8px",
              color: "#166534",
            }}
          >
            Shopify order customer enrichment is enabled. Purchase events can be enriched server-side with customer email, phone, name, and address when Shopify allows access.
          </p>

          <p style={{ margin: 0, color: "#4b5563" }}>
            Google Ads Data Manager purchase sending still works using click ID attribution and ecommerce data.
          </p>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
          gap: 16,
        }}
      >
        {platforms
          .filter((platform) =>
            ["google", "meta"].includes(platform.id)
          )
          .map((platform) => {
          const connection = connections[platform.id as keyof typeof connections];
          const isConnected = connection?.connected;

          return (
            <div
              key={platform.id}
              className="dh-platform-card"
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                backgroundColor: isConnected ? "#f0fdf4" : "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <img
                  src={platform.logo}
                  alt={`${platform.name} logo`}
                  style={{
                    width: 36,
                    height: 36,
                    objectFit: "contain",
                    marginRight: 12,
                    backgroundColor: "white",
                    borderRadius: 8,
                    padding: 4,
                    border: "1px solid #e5e7eb",
                  }}
                />

                <div>
                  <h3 style={{ margin: 0 }}>{platform.name}</h3>

                  {isConnected && connection.accountName && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#166534" }}>
                      Connected: {connection.accountName}
                    </p>
                  )}
                </div>
              </div>

              <p className="dh-platform-description" style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                {platform.description}
              </p>

              <div className="dh-platform-actions">
                {isConnected ? (
                  <>
                    <span
                      className="dh-button dh-button--active dh-button--compact"
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#16a34a",
                        color: "white",
                        borderRadius: 4,
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      Connected
                    </span>

                    <a
                      href={platform.oauthUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="dh-button dh-button--compact"
                    >
                      Reconnect
                    </a>

                    {connection.id && (
                      <Form method="post">
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <button
                          type="submit"
                          className="dh-button dh-button--danger dh-button--compact"
                        >
                          Disconnect
                        </button>
                      </Form>
                    )}
                  </>
                ) : (
                  <a
                    href={platform.oauthUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.primaryLink}
                  >
                    Connect {platform.name}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </main>
  );
}

const styles = {
  title: {
    margin: 0,
    color: "#111827",
    fontWeight: 800,
  },
  primaryLink: {
    display: "inline-block",
    padding: "8px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    textDecoration: "none",
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600,
  },
  secondaryLink: {
    display: "inline-block",
    padding: "8px 16px",
    backgroundColor: "white",
    color: "#111827",
    border: "1px solid #d1d5db",
    textDecoration: "none",
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600,
  },
  dangerButton: {
    padding: "8px 16px",
    backgroundColor: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  notice: {
    marginTop: 24,
    padding: 16,
    border: "1px solid #fed7aa",
    backgroundColor: "#fff7ed",
    borderRadius: 8,
  },
};
