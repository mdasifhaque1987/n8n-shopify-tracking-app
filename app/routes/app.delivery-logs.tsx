import { Link, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import { sanitizeForEventLog } from "../services/security/event-security.server";

type DeliveryLogRow = {
  id: string;
  createdAt: string;
  platform: string;
  eventName: string;
  status: string;
  message: string | null;
  responsePayload: unknown;
};

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function statusStyle(status: string) {
  if (status === "success") {
    return {
      backgroundColor: "#dcfce7",
      color: "#166534",
      border: "1px solid #bbf7d0",
    };
  }

  if (status === "failed") {
    return {
      backgroundColor: "#fee2e2",
      color: "#991b1b",
      border: "1px solid #fecaca",
    };
  }

  return {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    border: "1px solid #fde68a",
  };
}

function getRequestId(responsePayload: unknown) {
  if (!responsePayload || typeof responsePayload !== "object") {
    return "";
  }

  const payload = responsePayload as Record<string, unknown>;

  if (typeof payload.requestId === "string") {
    return payload.requestId;
  }

  const error = payload.error as Record<string, unknown> | undefined;

  if (error && typeof error.message === "string") {
    return error.message;
  }

  return "";
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (error) {
    return "{}";
  }
}


function getLogMode(log: { message?: string | null; responsePayload: unknown }) {
  const message = String(log.message || "");
  const payload =
    log.responsePayload && typeof log.responsePayload === "object"
      ? (log.responsePayload as Record<string, unknown>)
      : null;

  if (payload?.mode === "test") {
    return "test";
  }

  if (payload?.testMode === true || payload?.validateOnly === true) {
    return "test";
  }

  if (message.includes("[TEST MODE]")) {
    return "test";
  }

  return "live";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);

  const url = new URL(request.url);
  const navParams = new URLSearchParams();
  const host = url.searchParams.get("host");
  const embedded = url.searchParams.get("embedded");
  const locale = url.searchParams.get("locale");

  navParams.set("shop", session.shop);
  if (host) navParams.set("host", host);
  if (embedded) navParams.set("embedded", embedded);
  if (locale) navParams.set("locale", locale);
  const platform = url.searchParams.get("platform") || "";
  const status = url.searchParams.get("status") || "";
  const eventName = url.searchParams.get("eventName") || "";

  const logs = await db.eventDeliveryLog.findMany({
    where: {
      workspaceId: workspace.id,
      ...(platform ? { platform } : {}),
      ...(status ? { status } : {}),
      ...(eventName ? { eventName } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      platform: true,
      eventName: true,
      status: true,
      message: true,
      responsePayload: true,
    },
  });

  const safeLogs = logs.map((log) => ({
    ...log,
    responsePayload: log.responsePayload ? sanitizeForEventLog(log.responsePayload) : null,
  }));

  return {
    shop: session.shop,
    navQuery: navParams.toString(),
    filters: {
      platform,
      status,
      eventName,
    },
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })) as DeliveryLogRow[],
  };
}

export default function DeliveryLogsPage() {
  const { shop, navQuery, filters, logs } = useLoaderData<typeof loader>();

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <p style={{ margin: 0, color: "#2563eb", fontWeight: 800 }}>
          Data Hatches
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/assets/logos/dh-logo.svg"
            alt="Data Hatches logo"
            style={{ width: 48, height: 48, objectFit: "contain" }}
          />
          <h1 style={{ margin: "8px 0" }}>Event Delivery Logs</h1>
        </div>

        <p style={{ color: "#4b5563", margin: 0 }}>
          Review recent server-side event delivery results for {shop}.
        </p>
      </div>

      <div style={styles.notice}>
        <h3 style={{ marginTop: 0, color: "#1d4ed8" }}>
          Google Data Manager status
        </h3>

        <p style={{ margin: 0, color: "#1e40af" }}>
          Successful Google Ads server-side purchases should show messages like
          {" "}
          <strong>Google Data Manager purchase sent successfully</strong>
          {" "}
          or
          {" "}
          <strong>Google Data Manager purchase validation succeeded</strong>.
        </p>
      </div>

      <form
        method="get"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          backgroundColor: "#f9fafb",
        }}
      >
        <input type="hidden" name="shop" value={shop} />

        <label style={styles.filterLabel}>
          Platform
          <select name="platform" defaultValue={filters.platform} style={styles.select}>
            <option value="">All platforms</option>
            <option value="google_ads">Google Ads</option>
            <option value="ga4">GA4</option>
            <option value="meta">Meta</option>
            <option value="tiktok">TikTok</option>
            <option value="pinterest">Pinterest</option>
            <option value="microsoft">Microsoft Ads</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </label>

        <label style={styles.filterLabel}>
          Status
          <select name="status" defaultValue={filters.status} style={styles.select}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>

        <label style={styles.filterLabel}>
          Event
          <select name="eventName" defaultValue={filters.eventName} style={styles.select}>
            <option value="">All events</option>
            <option value="purchase">Purchase</option>
            <option value="begin_checkout">Begin checkout</option>
            <option value="add_payment_info">Add payment info</option>
            <option value="add_shipping_info">Add shipping info</option>
            <option value="page_view">Page view</option>
          </select>
        </label>

        <button type="submit" style={styles.primaryButton}>
          Apply filters
        </button>

        <Link to={`/app/delivery-logs?shop=${encodeURIComponent(shop)}`} style={styles.secondaryLink}>
          Reset
        </Link>
      </form>

      {logs.length === 0 ? (
        <div style={styles.emptyState}>
          <h3 style={{ marginTop: 0 }}>No delivery logs found</h3>
          <p style={{ marginBottom: 0 }}>
            Send a test event or complete a checkout to generate delivery logs.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {logs.map((log) => {
            const requestId = getRequestId(log.responsePayload);
            const logMode = getLogMode(log);

            return (
              <details
                key={log.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  backgroundColor: "white",
                  overflow: "hidden",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    padding: 16,
                    display: "grid",
                    gridTemplateColumns: "170px 130px 120px 1fr",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "#4b5563", fontSize: 13 }}>
                    {formatDate(log.createdAt)}
                  </span>

                  <span style={{ fontWeight: 700 }}>
                    {log.platform}
                  </span>

                  <span
                    style={{
                      ...statusStyle(log.status),
                      display: "inline-block",
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                    }}
                  >
                    {log.status}
                  </span>

                  <span>
                    <strong>{log.eventName}</strong>
                    {log.message ? ` — ${log.message}` : ""}
                  </span>
                </summary>

                <div style={{ padding: "0 16px 16px" }}>
                  {requestId && (
                    <p style={{ color: "#4b5563" }}>
                      <strong>Request / error:</strong> {requestId}
                    </p>
                  )}

                  <p
                    style={{
                      margin: "0 0 12px",
                      color: logMode === "test" ? "#9a3412" : "#166534",
                      fontWeight: 800,
                    }}
                  >
                    Mode: {logMode === "test" ? "TEST MODE" : "LIVE MODE"}
                  </p>

                  <pre style={styles.pre}>
                    {prettyJson(log.responsePayload)}
                  </pre>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </main>
  );
}

const styles = {
  notice: {
    padding: 16,
    border: "1px solid #bfdbfe",
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    marginBottom: 20,
  },
  filterLabel: {
    display: "grid",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
    color: "#374151",
  },
  select: {
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    minWidth: 180,
  },
  primaryButton: {
    alignSelf: "end",
    padding: "9px 16px",
    border: "none",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryLink: {
    alignSelf: "end",
    padding: "8px 16px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    color: "#374151",
    textDecoration: "none",
    fontWeight: 700,
    backgroundColor: "white",
  },
  emptyState: {
    padding: 24,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
  },
  pre: {
    padding: 12,
    backgroundColor: "#111827",
    color: "#f9fafb",
    borderRadius: 8,
    overflowX: "auto",
    fontSize: 12,
    lineHeight: 1.5,
  },
};
