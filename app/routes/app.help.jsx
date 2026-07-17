import { Link, useLoaderData, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

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
    shop: session.shop,
    navQuery: navParams.toString(),
  };
}

export default function HelpPage() {
  const { shop } = useLoaderData();
  const location = useLocation();
  const withNav = (path) => {
    const params = new URLSearchParams(location.search);
    if (!params.get("shop")) params.set("shop", shop);
    return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
  };
  const sections = [
    {
      title: "1. Connect platforms",
      body: "Go to Platform Connections and connect Google, Meta, TikTok, Pinterest, Microsoft Ads, LinkedIn, or other supported platforms. Google connection is required for GA4, Google Ads, and Data Manager API delivery."
    },
    {
      title: "2. Configure Google assets",
      body: "Go to Configuration. Connect or reconnect Google when you need to select or change GA4 properties, data streams, Google Ads accounts, conversion actions, or Merchant Center assets."
    },
    {
      title: "3. Enable server-side purchase sending",
      body: "Google Ads server-side purchase uses Google Data Manager API. Purchase events require attribution such as gclid, gbraid, or wbraid plus transaction_id, value, currency, and items."
    },
    {
      title: "4. Test events",
      body: "Use Event Delivery Logs to confirm whether events were sent, skipped, failed, or validated. The response payload includes request IDs and Google API responses."
    },
    {
      title: "5. Customer enrichment",
      body: "Shopify order customer enrichment is optional and disabled until Shopify approves Protected Customer Data access. After approval, enable SHOPIFY_ORDER_ENRICHMENT_ENABLED=true."
    },
    {
      title: "6. Production mode",
      body: "Use GOOGLE_ADS_DATA_MANAGER_VALIDATE_ONLY=true while testing. Change it to false only when you are ready to send real purchase conversions."
    }
  ];

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <section style={{
        padding: 24,
        borderRadius: 16,
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
        marginBottom: 24
      }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
          }}
        >
          <img
            src="/assets/logos/dh-logo.png"
            alt="DH Conversions"
            style={{
              height: 36,
              width: "auto",
              maxWidth: 88,
              objectFit: "contain",
              display: "block",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>

            <h1
              style={{
                margin: 0,
                lineHeight: 1.2,
                fontSize: 28,
              }}
            >
              Help / Configuration Guide
            </h1>
          </div>
        </div>

        <p style={{ color: "#4b5563", lineHeight: 1.6 }}>
          Follow these steps to configure tracking, platform connections, server-side delivery,
          and event monitoring.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
          <Link to={withNav("/app/connections")} style={styles.primaryLink}>Platform Connections</Link>
          <Link to={withNav("/app/settings")} style={styles.secondaryLink}>Configuration</Link>
          <Link to={withNav("/app/delivery-logs")} style={styles.secondaryLink}>Event Delivery Logs</Link>
        </div>
      </section>

      <div style={{ display: "grid", gap: 14 }}>
        {sections.map((section) => (
          <section key={section.title} style={{
            padding: 18,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white"
          }}>
            <h3 style={{ margin: "0 0 8px" }}>{section.title}</h3>
            <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.6 }}>{section.body}</p>
          </section>
        ))}
      </div>

      <section style={{
        padding: 18,
        borderRadius: 12,
        border: "1px solid #fed7aa",
        background: "#fff7ed",
        marginTop: 24
      }}>
        <h3 style={{ marginTop: 0, color: "#c2410c" }}>Protected Customer Data approval</h3>
        <p style={{ color: "#9a3412", lineHeight: 1.6 }}>
          When submitting the app for Shopify approval, request Protected Customer Data access for
          email, phone, first name, last name, address, and order customer data. This is needed for
          optional enhanced matching and server-side order enrichment.
        </p>
      </section>
    </main>
  );
}

const styles = {
  primaryLink: {
    display: "inline-block",
    padding: "10px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700,
  },
  secondaryLink: {
    display: "inline-block",
    padding: "10px 16px",
    backgroundColor: "white",
    color: "#111827",
    border: "1px solid #d1d5db",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700,
  },
};
