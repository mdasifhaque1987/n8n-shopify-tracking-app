import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import { getTestModeSettings } from "../services/test-mode.server";
import { getShopSubscription } from "../services/subscription.server";
import SubscriptionButton from "../components/SubscriptionButton";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const testModeSettings = await getTestModeSettings(workspace.id);
  const subscription = await getShopSubscription(session.shop);

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
  };
}

export default function HomePage() {
  const { navQuery, testModeSettings, subscription } = useLoaderData();
  const testModeEnabled = Boolean(testModeSettings?.enabled);

  const appPath = (path) => {
    if (!navQuery) {
      return path;
    }

    return `${path}${path.includes("?") ? "&" : "?"}${navQuery}`;
  };

  const cards = [
    {
      title: "Tracking Pixel",
      icon: "📡",
      text: "Collects Shopify events including page view, checkout started, contact info, shipping info, payment info, and purchase."
    },
    {
      title: "Google Ads Server-Side",
      icon: "🎯",
      text: "Sends purchase conversions through Google Data Manager API using click ID attribution and ecommerce data."
    },
    {
      title: "GA4 Ecommerce",
      icon: "📊",
      text: "Supports ecommerce event delivery with transaction ID, value, currency, and item data."
    },
    {
      title: "Attribution Capture",
      icon: "🧲",
      text: "Captures gclid, gbraid, wbraid, msclkid, fbclid, ttclid, and epik for better ad attribution."
    },
    {
      title: "Multi-Platform Ready",
      icon: "🔗",
      text: "Built for Google, Meta, TikTok, Pinterest, Microsoft Ads, LinkedIn, and future destination integrations."
    },
    {
      title: "Delivery Logs",
      icon: "🧾",
      text: "Shows server-side delivery status, success, failed, skipped events, response payloads, and request IDs."
    }
  ];

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <section style={{
        padding: 28,
        borderRadius: 20,
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        marginBottom: 24
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
<div>
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
          <span>Dashboard</span>
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
        </div>

        <p style={{ color: "#4b5563", lineHeight: 1.6, maxWidth: 850 }}>
          Manage Shopify conversion tracking, platform connections, server-side purchase delivery,
          attribution, catalog readiness, and event monitoring from one place.
        </p>

        <div className="dh-button-row" style={{ marginTop: 20 }}>
          <Link to={appPath("/app/settings")} className="dh-button dh-button--active">Open Configuration</Link>
          <Link to={appPath("/app/connections")} className="dh-button">Platform Connections</Link>
          <Link to={appPath("/app/delivery-logs")} className="dh-button">Event Delivery Logs</Link>
          <Link to={appPath("/app/help")} className="dh-button">Help / Documentation</Link>
          <SubscriptionButton
            subscription={subscription}
            to={appPath("/app/subscription")}
          />
        </div>
      </section>

      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        marginBottom: 24
      }}>
        {cards.map((card) => (
          <div key={card.title} style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 18,
            background: "white"
          }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>{card.icon}</div>
            <h3 style={{ margin: "0 0 8px" }}>{card.title}</h3>
            <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.55 }}>{card.text}</p>
          </div>
        ))}
      </section>

      <section style={{
        padding: 18,
        borderRadius: 12,
        background: "#fff7ed",
        border: "1px solid #fed7aa"
      }}>
        <h3 style={{ marginTop: 0, color: "#c2410c" }}>Protected Customer Data Notice</h3>
        <p style={{ margin: 0, color: "#9a3412", lineHeight: 1.6 }}>
          Google Data Manager purchase sending works with click ID attribution and ecommerce data.
          Customer enrichment from Shopify order data will stay disabled until Shopify approves
          Protected Customer Data access for this app.
        </p>
      </section>
    </main>
  );
}

const styles = {
  primaryButton: {
    display: "inline-block",
    padding: "10px 16px",
    background: "#2563eb",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700
  },
  darkButton: {
    display: "inline-block",
    padding: "10px 16px",
    background: "#111827",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700
  },
  secondaryButton: {
    display: "inline-block",
    padding: "10px 16px",
    background: "white",
    color: "#111827",
    border: "1px solid #d1d5db",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 700
  }
};
