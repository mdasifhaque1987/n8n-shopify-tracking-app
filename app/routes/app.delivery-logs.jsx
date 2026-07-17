import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";

export const loader = async ({ request }) => {
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
    take: 250,
  });

  return {
    shop: session.shop,
    navQuery: navParams.toString(),
    filters: {
      platform,
      status,
      eventName,
    },
    logs: logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      platform: log.platform,
      deliveryType: log.deliveryType,
      eventName: log.eventName,
      eventId: log.eventId,
      status: log.status,
      target: getLogTarget(
        log.responsePayload
      ),
      message: log.message,
    })),
  };
};

function getLogTarget(responsePayload) {
  if (
    !responsePayload ||
    typeof responsePayload !== "object" ||
    Array.isArray(responsePayload)
  ) {
    return "-";
  }

  return (
    responsePayload.conversionName ||
    responsePayload.measurementId ||
    responsePayload.conversionActionId ||
    responsePayload.conversionId ||
    "-"
  );
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getStatusStyle(status) {
  if (status === "sent" || status === "success") return styles.statusSuccess;
  if (status === "failed") return styles.statusFailed;
  if (status === "skipped") return styles.statusSkipped;

  return styles.statusDefault;
}

export default function DeliveryLogs() {
  const data = useLoaderData();

  const withNav = (path) => {
    const [basePath, existingQuery = ""] = path.split("?");
    const params = new URLSearchParams(existingQuery);
    const navParams = new URLSearchParams(data.navQuery || "");

    navParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });

    const query = params.toString();

    return query ? `${basePath}?${query}` : basePath;
  };

  const navigationFields = Array.from(
    new URLSearchParams(data.navQuery || "").entries()
  );

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Delivery Logs</h1>
          <p style={styles.subtitle}>{data.shop}</p>
        </div>

        <Link to={withNav("/app/settings")} style={styles.secondaryLink}>
          Back to settings
        </Link>
      </div>

      <Form
        method="get"
        action="/app/delivery-logs"
        style={styles.filters}
      >
        {navigationFields.map(([name, value]) => (
          <input
            key={name}
            type="hidden"
            name={name}
            value={value}
          />
        ))}

        <label style={styles.label}>
          Platform
          <select name="platform" defaultValue={data.filters.platform} style={styles.input}>
            <option value="">All</option>
            <option value="internal">Internal</option>
            <option value="ga4">GA4</option>
            <option value="google_ads">Google Ads</option>
            <option value="meta">Meta</option>
          </select>
        </label>

        <label style={styles.label}>
          Status
          <select name="status" defaultValue={data.filters.status} style={styles.input}>
            <option value="">All</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>

        <label style={styles.label}>
          Event
          <select name="eventName" defaultValue={data.filters.eventName} style={styles.input}>
            <option value="">All</option>
            <option value="page_view">Page view</option>
            <option value="view_item">View item</option>
            <option value="add_to_cart">Add to cart</option>
            <option value="begin_checkout">Begin checkout</option>
            <option value="add_shipping_info">Add shipping info</option>
            <option value="add_payment_info">Add payment info</option>
            <option value="purchase">Purchase</option>
          </select>
        </label>

        <button type="submit" style={styles.primaryButton}>
          Filter
        </button>

        <Link
          to={withNav("/app/delivery-logs")}
          style={styles.secondaryLink}
        >
          Clear
        </Link>
      </Form>

      {data.logs.length === 0 ? (
        <div style={styles.emptyState}>No delivery logs found.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Platform</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Event</th>
                <th style={styles.th}>Target</th>
                <th style={styles.th}>Event ID</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Message</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((log) => (
                <tr key={log.id}>
                  <td style={styles.td}>{formatDate(log.createdAt)}</td>
                  <td style={styles.td}>{log.platform}</td>
                  <td style={styles.td}>{log.deliveryType}</td>
                  <td style={styles.td}>{log.eventName}</td>
                  <td style={styles.td}>{log.target}</td>
                  <td style={styles.tdSmall}>{log.eventId}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.statusBadge, ...getStatusStyle(log.status) }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={styles.td}>{log.message || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const styles = {
  page: {
    padding: 24,
    fontFamily: "Inter, Arial, sans-serif",
    color: "#111827",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 28,
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#6b7280",
  },
  filters: {
    display: "flex",
    gap: 12,
    alignItems: "end",
    flexWrap: "wrap",
    marginBottom: 20,
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
  },
  input: {
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    minWidth: 180,
  },
  primaryButton: {
    padding: "9px 16px",
    border: "none",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryLink: {
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
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: 12,
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
    whiteSpace: "nowrap",
  },
  td: {
    padding: 12,
    borderBottom: "1px solid #e5e7eb",
    verticalAlign: "top",
  },
  tdSmall: {
    padding: 12,
    borderBottom: "1px solid #e5e7eb",
    verticalAlign: "top",
    fontSize: 12,
    maxWidth: 260,
    overflowWrap: "anywhere",
  },
  statusBadge: {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
  },
  statusSuccess: {
    backgroundColor: "#dcfce7",
    color: "#166534",
    border: "1px solid #bbf7d0",
  },
  statusFailed: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fecaca",
  },
  statusSkipped: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    border: "1px solid #fde68a",
  },
  statusDefault: {
    backgroundColor: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
  },
};
