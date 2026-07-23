export type Ga4Property = {
  propertyId: string;
  resourceName: string;
  displayName: string;
  accountId: string;
  accountDisplayName: string;
  propertyType: string;
  canEdit?: boolean;
};

type PropertySummary = {
  property?: string;
  displayName?: string;
  propertyType?: string;
  parent?: string;
  canEdit?: boolean;
};

type AccountSummary = {
  account?: string;
  displayName?: string;
  propertySummaries?: PropertySummary[];
};

type AccountSummariesResponse = {
  accountSummaries?: AccountSummary[];
  nextPageToken?: string;
};

export type Ga4DiscoveryErrorCategory =
  | "expired_token"
  | "insufficient_permission"
  | "api_disabled"
  | "pagination_failure"
  | "api_error";

export class Ga4DiscoveryError extends Error {
  constructor(
    message: string,
    public readonly category: Ga4DiscoveryErrorCategory,
    public readonly status: number
  ) {
    super(message);
    this.name = "Ga4DiscoveryError";
  }
}

async function errorForResponse(response: Response, pageNumber: number) {
  const status = response.status;
  if (status === 401) {
    return new Ga4DiscoveryError(
      "Your Google session expired. Reconnect Google and try again.",
      "expired_token",
      status
    );
  }

  if (status === 403) {
    const errorText = await response.text().catch(() => "");
    const apiDisabled =
      /SERVICE_DISABLED|API has not been used|is disabled/i.test(errorText);
    return new Ga4DiscoveryError(
      apiDisabled
        ? "The Google Analytics Admin API is disabled for this OAuth project. Enable it, then try again."
        : "Google Analytics access was denied. Reconnect Google and grant Analytics read-only permission.",
      apiDisabled ? "api_disabled" : "insufficient_permission",
      status
    );
  }

  return new Ga4DiscoveryError(
    pageNumber > 1
      ? "Google Analytics property pagination failed. Try loading the properties again."
      : "Google Analytics properties could not be loaded.",
    pageNumber > 1 ? "pagination_failure" : "api_error",
    status
  );
}

export async function discoverGa4Properties(
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<Ga4Property[]> {
  const properties = new Map<string, Ga4Property>();
  let pageToken = "";
  let pageNumber = 0;
  let accountCount = 0;

  do {
    pageNumber += 1;
    const url = new URL(
      "https://analyticsadmin.googleapis.com/v1alpha/accountSummaries"
    );
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new Ga4DiscoveryError(
        pageNumber > 1
          ? "Google Analytics property pagination failed. Try loading the properties again."
          : "Google Analytics properties could not be loaded.",
        pageNumber > 1 ? "pagination_failure" : "api_error",
        0
      );
    }

    if (!response.ok) throw await errorForResponse(response, pageNumber);

    let data: AccountSummariesResponse;
    try {
      data = (await response.json()) as AccountSummariesResponse;
    } catch {
      throw new Ga4DiscoveryError(
        "Google Analytics returned an invalid response.",
        pageNumber > 1 ? "pagination_failure" : "api_error",
        response.status
      );
    }

    const accounts = data.accountSummaries || [];
    accountCount += accounts.length;

    for (const account of accounts) {
      const accountResourceName = String(account.account || "");
      const accountId = accountResourceName.replace(/^accounts\//, "");

      for (const property of account.propertySummaries || []) {
        const resourceName = String(property.property || "");
        const propertyId = resourceName.replace(/^properties\//, "").trim();
        if (!propertyId || properties.has(propertyId)) continue;

        properties.set(propertyId, {
          propertyId,
          resourceName,
          displayName: String(property.displayName || ""),
          accountId,
          accountDisplayName: String(account.displayName || ""),
          propertyType: String(property.propertyType || ""),
          ...(typeof property.canEdit === "boolean"
            ? { canEdit: property.canEdit }
            : {}),
        });
      }
    }

    pageToken = String(data.nextPageToken || "");
  } while (pageToken);

  console.info("[GA4 Discovery] Completed", {
    accounts: accountCount,
    properties: properties.size,
  });

  return Array.from(properties.values());
}

export function formatGa4PropertyLabel(property: Ga4Property) {
  if (!property.displayName) return property.propertyId;
  if (!property.accountDisplayName) {
    return `${property.displayName} (${property.propertyId})`;
  }
  return `${property.displayName} — ${property.accountDisplayName} (${property.propertyId})`;
}

export function reconcileGa4Selection(
  savedPropertyId: string,
  properties: Ga4Property[]
) {
  if (!savedPropertyId) return { selectedPropertyId: "", stale: false };
  const exists = properties.some(
    (property) => property.propertyId === savedPropertyId
  );
  return {
    selectedPropertyId: exists ? savedPropertyId : "",
    stale: !exists,
  };
}
