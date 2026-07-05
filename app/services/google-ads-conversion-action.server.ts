const DEFAULT_API_VERSION = "v24";

type ConversionValueMode = "dynamic" | "fixed" | "none" | string;

type GoogleAdsConversionActionInput = {
  accessToken: string;
  customerId: string;
  eventName: string;
  baseName?: string;
  conversionValueMode?: ConversionValueMode;
};

type GoogleAdsConversionActionResult = {
  id?: string;
  name: string;
  resourceName: string;
  category?: string;
  reused?: boolean;
  conversionId?: string;
  conversionLabel?: string;
  tagSnippets?: unknown[];
};

function getApiVersion() {
  return process.env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION;
}

function cleanCustomerId(customerId: string) {
  return String(customerId || "").replace(/-/g, "").trim();
}

function getDeveloperToken() {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!token) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is missing");
  }

  return token;
}

function getHeaders(accessToken: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": getDeveloperToken(),
    "Content-Type": "application/json",
  };

  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  if (loginCustomerId) {
    headers["login-customer-id"] = cleanCustomerId(loginCustomerId);
  }

  return headers;
}

function escapeGaql(value: string) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function categoryForEvent(eventName: string) {
  const map: Record<string, string> = {
    PAGE_VIEW: "PAGE_VIEW",
    VIEW_ITEM: "DEFAULT",
    VIEW_ITEM_LIST: "DEFAULT",
    ADD_TO_CART: "ADD_TO_CART",
    BEGIN_CHECKOUT: "BEGIN_CHECKOUT",
    PURCHASE: "PURCHASE",
    LEAD: "SUBMIT_LEAD_FORM",
    SUBSCRIBE: "SIGNUP",
  };

  return map[eventName] || "DEFAULT";
}

function buildConversionName(baseName: string | undefined, eventName: string) {
  const cleanBase = String(baseName || "").trim();

  if (!cleanBase) {
    return `Shopify ${eventName}`;
  }

  const normalizedEvent = String(eventName || "").replace(/_/g, " ");

  if (cleanBase.toLowerCase().includes(normalizedEvent.toLowerCase())) {
    return cleanBase;
  }

  return `${cleanBase} - ${eventName}`;
}

function extractIdFromResourceName(resourceName?: string) {
  const match = String(resourceName || "").match(/conversionActions\/(\d+)/);
  return match ? match[1] : undefined;
}

function extractTagDetails(action: any) {
  const tagSnippets = action?.tagSnippets || action?.tag_snippets || [];
  const combined = JSON.stringify(tagSnippets || []);

  const sendToMatch =
    combined.match(/AW-(\d+)\/([A-Za-z0-9_-]+)/) ||
    combined.match(/send_to['"]?\s*[:=]\s*['"]AW-(\d+)\/([A-Za-z0-9_-]+)/);

  const awOnlyMatch = combined.match(/AW-(\d+)/);

  const conversionId =
    sendToMatch?.[1] ||
    awOnlyMatch?.[1] ||
    extractIdFromResourceName(action?.resourceName || action?.resource_name);

  const conversionLabel = sendToMatch?.[2];

  return {
    conversionId,
    conversionLabel,
    tagSnippets,
  };
}

async function googleAdsSearch(
  accessToken: string,
  customerId: string,
  query: string
) {
  const cleanId = cleanCustomerId(customerId);
  const response = await fetch(
    `https://googleads.googleapis.com/${getApiVersion()}/customers/${cleanId}/googleAds:search`,
    {
      method: "POST",
      headers: getHeaders(accessToken),
      body: JSON.stringify({ query }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Google Ads search failed with status ${response.status}`
    );
  }

  return data?.results || [];
}

async function findConversionActionByName(
  accessToken: string,
  customerId: string,
  name: string
): Promise<GoogleAdsConversionActionResult | null> {
  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.resource_name,
      conversion_action.category,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.name = '${escapeGaql(name)}'
    LIMIT 1
  `;

  const results = await googleAdsSearch(accessToken, customerId, query);
  const row = results?.[0];

  if (!row?.conversionAction) {
    return null;
  }

  const action = row.conversionAction;
  const tagDetails = extractTagDetails(action);

  return {
    id: action.id ? String(action.id) : extractIdFromResourceName(action.resourceName),
    name: action.name,
    resourceName: action.resourceName,
    category: action.category,
    reused: true,
    conversionId: tagDetails.conversionId,
    conversionLabel: tagDetails.conversionLabel,
    tagSnippets: tagDetails.tagSnippets,
  };
}

async function findConversionActionByResourceName(
  accessToken: string,
  customerId: string,
  resourceName: string
): Promise<GoogleAdsConversionActionResult | null> {
  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.resource_name,
      conversion_action.category,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.resource_name = '${escapeGaql(resourceName)}'
    LIMIT 1
  `;

  const results = await googleAdsSearch(accessToken, customerId, query);
  const row = results?.[0];

  if (!row?.conversionAction) {
    return null;
  }

  const action = row.conversionAction;
  const tagDetails = extractTagDetails(action);

  return {
    id: action.id ? String(action.id) : extractIdFromResourceName(action.resourceName),
    name: action.name,
    resourceName: action.resourceName,
    category: action.category,
    reused: false,
    conversionId: tagDetails.conversionId,
    conversionLabel: tagDetails.conversionLabel,
    tagSnippets: tagDetails.tagSnippets,
  };
}

async function createConversionAction(
  accessToken: string,
  customerId: string,
  conversionName: string,
  eventName: string,
  conversionValueMode: ConversionValueMode = "dynamic",
  isPrimary = true
) {
  const cleanId = cleanCustomerId(customerId);

  const response = await fetch(
    `https://googleads.googleapis.com/${getApiVersion()}/customers/${cleanId}/conversionActions:mutate`,
    {
      method: "POST",
      headers: getHeaders(accessToken),
      body: JSON.stringify({
        operations: [
          {
            create: {
              name: conversionName,
              type: "WEBPAGE",
              category: categoryForEvent(eventName),
              status: "ENABLED",
              primaryForGoal: isPrimary,
              valueSettings: {
                defaultValue: eventName === "PURCHASE" ? 1 : 0,
                alwaysUseDefaultValue: conversionValueMode !== "dynamic",
              },
            },
          },
        ],
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Google Ads conversion action create failed with status ${response.status}`
    );
  }

  const resourceName = data?.results?.[0]?.resourceName;

  if (!resourceName) {
    throw new Error("Google Ads did not return conversion action resourceName");
  }

  return resourceName;
}

export async function createOrReuseGoogleAdsConversionAction(
  input: GoogleAdsConversionActionInput
): Promise<GoogleAdsConversionActionResult> {
  const conversionName = buildConversionName(input.baseName, input.eventName);

  const existing = await findConversionActionByName(
    input.accessToken,
    input.customerId,
    conversionName
  );

  if (existing) {
    return existing;
  }

  const resourceName = await createConversionAction(
    input.accessToken,
    input.customerId,
    conversionName,
    input.eventName,
    input.conversionValueMode,
    input.isPrimary !== false
  );

  const created = await findConversionActionByResourceName(
    input.accessToken,
    input.customerId,
    resourceName
  );

  if (created) {
    return created;
  }

  return {
    id: extractIdFromResourceName(resourceName),
    name: conversionName,
    resourceName,
    category: categoryForEvent(input.eventName),
    reused: false,
    conversionId: cleanCustomerId(input.customerId),
    conversionLabel: undefined,
    tagSnippets: [],
  };
}
