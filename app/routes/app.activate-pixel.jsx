import { Form, Link, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import {
  getEventIngestPixelStatus,
  rotateEventIngestPixelCredential,
} from "../services/shopify-web-pixel.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const shopHandle = session.shop.replace(".myshopify.com", "");
  const params = new URLSearchParams();

  params.set("shop", session.shop);

  for (const key of ["host", "embedded", "locale"]) {
    const value = url.searchParams.get(key);

    if (value) {
      params.set(key, value);
    }
  }

  const pixelStatus = await getEventIngestPixelStatus(session.shop, admin);

  return {
    ok: true,
    shop: session.shop,
    shopHandle,
    navQuery: params.toString(),
    title: "Web Pixel Status",
    status: pixelStatus.ingestKeyConfigured
      ? "Event ingestion key active"
      : "Pixel refresh required",
    ingestKeyConfigured: pixelStatus.ingestKeyConfigured,
    message:
      pixelStatus.ingestKeyConfigured
        ? "This pixel has a public write-only installation key for tenant routing and rate-limit partitioning. It does not prove that telemetry came from Shopify. Rotating it revokes the previous key."
        : "Refresh the Shopify web pixel to add its public write-only installation key. Client telemetry is rejected until this is completed.",
    nextSteps: [
      "Use Shopify Admin → Settings → Customer events to review the app pixel connection.",
      "Use the app Configuration page to manage Meta, GA4, Google Ads, and server-side settings.",
      "Use Shopify Dev Console → Clean dev preview → Web preview for development testing.",
    ],
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);

  try {
    const result = await rotateEventIngestPixelCredential({
      shop: session.shop,
      workspaceId: workspace.id,
      admin,
    });

    return { ok: true, message: result.created ? "Web pixel and installation key created." : "Public installation key rotated." };
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Pixel update failed." },
      { status: 500 },
    );
  }
};

export default function ActivatePixel() {
  const data = useLoaderData();
  const actionData = useActionData();

  const appPath = (path) => {
    if (!data.navQuery) {
      return path;
    }

    return `${path}${path.includes("?") ? "&" : "?"}${data.navQuery}`;
  };

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>{data.title}</h1>

        <div
          style={{
            ...styles.status,
            ...(data.ingestKeyConfigured ? styles.success : styles.warning),
          }}
        >
          {data.status}
        </div>

        <p style={styles.text}>{data.message}</p>

        {actionData?.message ? (
          <p style={styles.text}>{actionData.message}</p>
        ) : null}

        <Form method="post">
          <button type="submit" style={styles.primaryLink}>
            {data.ingestKeyConfigured ? "Rotate installation key" : "Refresh web pixel"}
          </button>
        </Form>

        <div style={styles.stepsBox}>
          <h3 style={styles.smallHeading}>Next steps</h3>
          <ol style={styles.list}>
            {data.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div style={styles.actions}>
          <a
            href={`https://admin.shopify.com/store/${data.shopHandle}/settings/customer_events`}
            target="_blank"
            rel="noreferrer"
            style={styles.primaryLink}
          >
            Open Customer events
          </a>

          <Link
            to={appPath("/app/settings")}
            style={styles.secondaryLink}
          >
            Go to Configuration
          </Link>

          <Link
            to={appPath("/app")}
            style={styles.secondaryLink}
          >
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}

const styles = {
  page: {
    padding: 24,
    fontFamily: "Inter, Arial, sans-serif",
    color: "#111827",
    backgroundColor: "#f9fafb",
    minHeight: "100vh",
  },
  card: {
    maxWidth: 860,
    margin: "0 auto",
    padding: 24,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    backgroundColor: "white",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  title: {
    margin: "0 0 12px",
    fontSize: 28,
  },
  status: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 16,
  },
  success: {
    backgroundColor: "#dcfce7",
    color: "#166534",
    border: "1px solid #bbf7d0",
  },
  warning: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    border: "1px solid #fde68a",
  },
  smallHeading: {
    margin: "0 0 8px",
    fontSize: 16,
  },
  text: {
    margin: "0 0 16px",
    color: "#374151",
    lineHeight: 1.6,
  },
  stepsBox: {
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    marginTop: 16,
  },
  list: {
    margin: 0,
    paddingLeft: 22,
    lineHeight: 1.7,
  },
  actions: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 20,
  },
  primaryLink: {
    padding: "10px 16px",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    color: "white",
    textDecoration: "none",
    fontWeight: 700,
  },
  secondaryLink: {
    padding: "9px 16px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    color: "#374151",
    textDecoration: "none",
    fontWeight: 700,
    backgroundColor: "white",
  },
};
