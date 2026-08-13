import { useEffect, useRef } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { authenticate } from "../shopify.server";
import { sendEmail } from "../services/email.server";

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

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const message = String(formData.get("message") || "").trim();

  if (!name || !email || !subject || !message) {
    return {
      ok: false,
      error: "Please complete all support form fields.",
    };
  }

  if (!email.includes("@")) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
    };
  }

  const shop = session.shop;
  const submittedAt = new Date().toISOString();

  try {
    await sendEmail({
      to: process.env.SUPPORT_EMAIL || "info@app.datahatches.com",
      subject: `[DH Conversions Support] ${subject}`,
      replyTo: email,
      text: [
        "New DH Conversions support request",
        "",
        `Merchant name: ${name}`,
        `Merchant email: ${email}`,
        `Shop: ${shop}`,
        `Submitted: ${submittedAt}`,
        "",
        "Message:",
        message,
      ].join("\n"),
      html: `
        <h2>New DH Conversions support request</h2>
        <p><strong>Merchant name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Merchant email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Shop:</strong> ${escapeHtml(shop)}</p>
        <p><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>
        <hr />
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
      `,
    });

    return {
      ok: true,
      message: "Your support request was sent successfully.",
    };
  } catch (error) {
    console.error("[Support Email] Failed to send support request", {
      shop,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error:
        "We could not send the support request right now. Please try again shortly.",
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function HelpPage() {
  const { shop } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const formRef = useRef(null);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok && formRef.current) {
      formRef.current.reset();
    }
  }, [actionData]);

  const withNav = (path) => {
    const params = new URLSearchParams(location.search);
    if (!params.get("shop")) params.set("shop", shop);
    return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
  };

  const sections = [
    {
      title: "1. Platform Connections",
      body:
        "Connect Google, Meta, TikTok, Pinterest, Microsoft Ads, or LinkedIn from Platform Connections. Reconnect a platform when permissions or accessible assets change. Disconnecting clears that platform's saved asset selections so a fresh connection does not inherit stale checkboxes or assets.",
    },
    {
      title: "2. Google Analytics 4",
      body:
        "Select the GA4 property and web data stream / Measurement ID. Choose the ecommerce events to send and select the item ID format. Important account assets are locked after selection to prevent accidental changes.",
    },
    {
      title: "3. GA4 Client-side and Server-side",
      body:
        "Client-side GA4 events are sent through Shopify Customer Events. Server-side GA4 uses Measurement Protocol and requires the selected Measurement ID plus a GA4 API Secret.",
    },
    {
      title: "4. Google Ads Conversions",
      body:
        "Select the Google Ads customer account, Shopify conversion event, conversion name, goal role, conversion value behavior, item ID format, and delivery mode. DH Conversions creates or reuses the corresponding Google Ads conversion action.",
    },
    {
      title: "5. Google Ads Server-side Delivery",
      body:
        "Supported server-side Google Ads conversion delivery uses available attribution identifiers such as gclid, gbraid, or wbraid together with transaction ID, value, currency, items, and available matching data. Google API access also depends on OAuth permissions, developer token access, and the Google Ads account hierarchy.",
    },
    {
      title: "6. Google Ads Remarketing",
      body:
        "Enable remarketing separately and choose the Shopify ecommerce events to use. For dynamic product matching, use the same item ID format as the Merchant Center product feed.",
    },
    {
      title: "7. Google Merchant Center",
      body:
        "Select the Merchant Center account, target country, product ID format, channel, marketing method, and feed update schedule. Standard countries are displayed as Country Name - ISO Code. The Custom country code input appears only after Custom country code is selected.",
    },
    {
      title: "8. Meta Pixel and Conversions API",
      body:
        "Select the Meta Business Portfolio and Dataset / Pixel. Choose Meta events, content ID format, and client-side Pixel or server-side CAPI delivery. Server-side Meta CAPI requires a valid access token. Meta Test Event Code can be used for supported testing.",
    },
    {
      title: "9. Other Platforms",
      body:
        "TikTok, Pinterest, Microsoft Ads, and LinkedIn configuration becomes available after connecting the relevant platform account. Select the applicable advertising account, pixel/tag, API destination, catalog, UET tag, Merchant Center, Insight Tag, or conversion rule when supported.",
    },
    {
      title: "10. Product and Item ID Matching",
      body:
        "For ecommerce catalog and remarketing matching, keep product identifiers consistent across Merchant Center, GA4 ecommerce items, Google Ads remarketing, Meta content IDs, and other supported catalog integrations.",
    },
    {
      title: "11. Test / Debug Mode",
      body:
        "Use test mode while validating event delivery. Platform test behavior differs between GA4, Google Ads, Meta, and other destinations. Review Event Delivery Logs and the destination platform before switching to normal production delivery.",
    },
    {
      title: "12. Event Delivery Logs",
      body:
        "Use Event Delivery Logs to review successful, validated, skipped, and failed delivery attempts. Logs can provide destination API responses, request IDs, event identifiers, and attribution information useful for troubleshooting.",
    },
    {
      title: "13. Reconnect and Locked Selections",
      body:
        "Important platform assets are locked after selection to reduce accidental changes. Reconnect the platform when you intentionally need to change accessible assets or permissions. Disconnect when you want to clear saved asset selections and start a fresh connection.",
    },
    {
      title: "14. Protected Customer Data",
      body:
        "Optional customer enrichment depends on Shopify Protected Customer Data approval. When Shopify allows access, available email, phone, first name, last name, address, and order customer data can support enhanced matching, attribution, deduplication, and supported server-side conversion delivery.",
    },
  ];

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <section
        style={{
          padding: 24,
          borderRadius: 16,
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          marginBottom: 24,
        }}
      >
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
          Follow these steps to configure tracking, platform connections,
          client-side and server-side delivery, product matching,
          test mode, and event monitoring.
        </p>

        <p
          style={{
            color: "#166534",
            lineHeight: 1.6,
            fontWeight: 700,
          }}
        >
          Product website and documentation:{" "}
          <a
            href="https://app.datahatches.com"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#15803d",
            }}
          >
            https://app.datahatches.com
          </a>
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 18,
          }}
        >
          <Link
            to={withNav("/app/connections")}
            style={styles.primaryLink}
          >
            Platform Connections
          </Link>

          <Link
            to={withNav("/app/settings")}
            style={styles.secondaryLink}
          >
            Configuration
          </Link>

          <Link
            to={withNav("/app/delivery-logs")}
            style={styles.secondaryLink}
          >
            Event Delivery Logs
          </Link>
        </div>
      </section>

      <div style={{ display: "grid", gap: 14 }}>
        {sections.map((section) => (
          <section
            key={section.title}
            style={{
              padding: 18,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "white",
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>{section.title}</h3>
            <p
              style={{
                margin: 0,
                color: "#4b5563",
                lineHeight: 1.6,
              }}
            >
              {section.body}
            </p>
          </section>
        ))}
      </div>

      <section
        style={{
          padding: 18,
          borderRadius: 12,
          border: "1px solid #fed7aa",
          background: "#fff7ed",
          marginTop: 24,
        }}
      >
        <h3 style={{ marginTop: 0, color: "#c2410c" }}>
          Protected Customer Data approval
        </h3>

        <p style={{ color: "#9a3412", lineHeight: 1.6 }}>
          When submitting the app for Shopify approval, request Protected
          Customer Data access for email, phone, first name, last name,
          address, and order customer data. This is needed for optional
          enhanced matching and server-side order enrichment.
        </p>
      </section>

      <section
        style={{
          padding: 24,
          borderRadius: 16,
          border: "1px solid #d1d5db",
          background: "white",
          marginTop: 24,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Contact Support</h2>

        <p style={{ color: "#4b5563", lineHeight: 1.6 }}>
          Need help with DH Conversions? Send us a message and include as much
          detail as possible about the issue.
        </p>

        <p
          style={{
            padding: 12,
            background: "#f8fafc",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          <strong>Shop:</strong> {shop}
        </p>

        {actionData?.message ? (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              borderRadius: 8,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
            }}
          >
            {actionData.message}
          </div>
        ) : null}

        {actionData?.error ? (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              borderRadius: 8,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
            }}
          >
            {actionData.error}
          </div>
        ) : null}

        <Form
          ref={formRef}
          method="post"
          style={{ display: "grid", gap: 14 }}
          onSubmit={(event) => {
            if (isSubmitting) {
              event.preventDefault();
            }
          }}
        >
          <label style={styles.field}>
            <span style={styles.label}>Your name</span>
            <input type="text" name="name" required style={styles.input} />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Email address</span>
            <input type="email" name="email" required style={styles.input} />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Subject</span>
            <input type="text" name="subject" required style={styles.input} />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Message</span>
            <textarea
              name="message"
              rows={7}
              required
              style={{
                ...styles.input,
                resize: "vertical",
                minHeight: 140,
              }}
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.submitButton,
              opacity: isSubmitting ? 0.65 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Sending..." : "Send Support Request"}
          </button>
        </Form>
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

  field: {
    display: "grid",
    gap: 6,
  },

  label: {
    fontWeight: 700,
    color: "#111827",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 15,
    fontFamily: "inherit",
  },

  submitButton: {
    justifySelf: "start",
    border: 0,
    borderRadius: 8,
    padding: "11px 18px",
    background: "#2563eb",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
};
