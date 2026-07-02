import { Form, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import {
  deactivateConnection,
  getWorkspaceConnections,
} from "../services/platform-connection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const savedConnections = await getWorkspaceConnections(workspace.id);

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

  return {
    shop: session.shop,
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
  await authenticate.admin(request);

  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId") || "");

  if (connectionId) {
    await deactivateConnection(connectionId);
  }

  return redirect("/app/connections");
}

export default function ConnectionsPage() {
  const { shop, connections, customerEnrichment } = useLoaderData<typeof loader>();

  const platforms = [
    {
      id: "google",
      name: "Google",
      description: "Connect Google Analytics, Google Ads, and Google Merchant Center",
      icon: "🔵",
      oauthUrl: `/api/oauth/google-init?shop=${shop}`,
    },
    {
      id: "meta",
      name: "Meta (Facebook)",
      description: "Connect Facebook Pixel, Instagram, and Meta Business",
      icon: "📘",
      oauthUrl: `/api/oauth/meta-init?shop=${shop}`,
    },
    {
      id: "tiktok",
      name: "TikTok",
      description: "Connect TikTok Pixel and TikTok Ads",
      icon: "🎵",
      oauthUrl: `/api/oauth/tiktok-init?shop=${shop}`,
    },
    {
      id: "pinterest",
      name: "Pinterest",
      description: "Connect Pinterest Tag and Pinterest Ads",
      icon: "📌",
      oauthUrl: `/api/oauth/pinterest-init?shop=${shop}`,
    },
    {
      id: "microsoft",
      name: "Microsoft Ads",
      description: "Connect Bing UET and Microsoft Advertising",
      icon: "🪟",
      oauthUrl: `/api/oauth/microsoft-init?shop=${shop}`,
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      description: "Connect LinkedIn Insight Tag and LinkedIn Ads",
      icon: "💼",
      oauthUrl: `/api/oauth/linkedin-init?shop=${shop}`,
    },
  ];

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1>Platform Connections</h1>
      <p style={{ marginBottom: 24, color: "#666" }}>
        Connect, reconnect, or disconnect advertising platforms used for tracking and catalog sync.
      </p>

      <div
        style={{
          border: customerEnrichment.enabled ? "1px solid #bbf7d0" : "1px solid #fed7aa",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          backgroundColor: customerEnrichment.enabled ? "#f0fdf4" : "#fff7ed",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            color: customerEnrichment.enabled ? "#166534" : "#c2410c",
          }}
        >
          {customerEnrichment.enabled
            ? "✅ Customer enrichment enabled"
            : "⚠️ Customer enrichment disabled"}
        </h3>

        <p
          style={{
            margin: "0 0 8px",
            color: customerEnrichment.enabled ? "#166534" : "#9a3412",
          }}
        >
          {customerEnrichment.enabled
            ? "Shopify order customer enrichment is enabled. Purchase events can be enriched server-side with customer email, phone, name, and address when Shopify allows access."
            : "Shopify order customer enrichment is disabled until Protected Customer Data access is approved by Shopify."}
        </p>

        <p style={{ margin: "0 0 8px", color: "#4b5563" }}>
          Google Ads Data Manager purchase sending still works using click ID attribution and ecommerce data.
        </p>

        {!customerEnrichment.enabled && (
          <p style={{ margin: 0, color: "#4b5563" }}>
            After Shopify approves Protected Customer Data access, set{" "}
            <code>SHOPIFY_ORDER_ENRICHMENT_ENABLED=true</code> and restart the app.
          </p>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
          gap: 16,
        }}
      >
        {platforms.map((platform) => {
          const connection = connections[platform.id as keyof typeof connections];
          const isConnected = connection?.connected;

          return (
            <div
              key={platform.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                backgroundColor: isConnected ? "#f0fdf4" : "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 32, marginRight: 12 }}>{platform.icon}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{platform.name}</h3>
                  {isConnected && connection.accountName && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#166534" }}>
                      Connected: {connection.accountName}
                    </p>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                {platform.description}
              </p>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {isConnected ? (
                  <>
                    <span
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
                      style={styles.primaryLink}
                    >
                      Reconnect
                    </a>

                    {connection.id && (
                      <Form method="post">
                        <input type="hidden" name="connectionId" value={connection.id} />
                        <button type="submit" style={styles.dangerButton}>
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

      <div style={styles.notice}>
        <h3 style={{ marginTop: 0, color: "#c2410c" }}>🔐 OAuth Authentication</h3>
        <p style={{ marginBottom: 0, color: "#9a3412" }}>
          Clicking Connect or Reconnect opens a new tab to authenticate with the platform.
          After successful authentication, you will be redirected back to the Shopify app.
        </p>
      </div>
    </main>
  );
}

const styles = {
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
    marginTop: 32,
    padding: 16,
    backgroundColor: "#fff7ed",
    border: "1px solid #fdba74",
    borderRadius: 8,
  },
};
