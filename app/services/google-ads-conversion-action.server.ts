const DEFAULT_API_VERSION = "v24";

type ConversionValueMode = "dynamic" | "fixed" | "none" | string;

type GoogleAdsConversionActionInput = {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string;
  eventName: string;
  baseName?: string;
  conversionValueMode?: ConversionValueMode;
  isPrimary?: boolean;
};

type GoogleAdsConversionActionResult = {
  id?: string;
  name: string;
  resourceName: string;
  category?: string;
  status?: string;
  origin?: string;
  type?: string;
  primaryForGoal?: boolean;
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

function getHeaders(
  accessToken: string,
  loginCustomerId?: string
) {
  const headers: Record<string, string> = {
    Authorization:
      `Bearer ${accessToken}`,
    "developer-token":
      getDeveloperToken(),
    "Content-Type":
      "application/json",
  };

  const resolvedLoginCustomerId =
    cleanCustomerId(
      loginCustomerId ||
      process.env
        .GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
      ""
    );

  if (resolvedLoginCustomerId) {
    headers["login-customer-id"] =
      resolvedLoginCustomerId;
  }

  return headers;
}

function formatGoogleAdsApiError(
  data: any,
  status: number,
  requestId?: string | null
) {
  const parts: string[] = [];

  if (data?.error?.message) {
    parts.push(String(data.error.message));
  } else {
    parts.push(
      `Google Ads API request failed with status ${status}`
    );
  }

  if (data?.error?.status) {
    parts.push(
      `Status: ${String(data.error.status)}`
    );
  }

  const details = Array.isArray(data?.error?.details)
    ? data.error.details
    : [];

  for (const detail of details) {
    const errors = Array.isArray(detail?.errors)
      ? detail.errors
      : [];

    for (const error of errors) {
      const codeObject =
        error?.errorCode &&
        typeof error.errorCode === "object"
          ? error.errorCode
          : {};

      const code = Object.entries(codeObject)
        .map(
          ([key, value]) =>
            `${key}: ${String(value)}`
        )
        .join(", ");

      if (code) {
        parts.push(code);
      }

      if (error?.message) {
        parts.push(String(error.message));
      }
    }
  }

  if (requestId) {
    parts.push(`Request ID: ${requestId}`);
  }

  return Array.from(new Set(parts))
    .filter(Boolean)
    .join(" | ");
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

function buildConversionName(
  baseName: string | undefined,
  eventName: string
) {
  const customName =
    String(
      baseName || ""
    ).trim();

  /*
   * If the merchant supplied a name,
   * preserve it exactly.
   */
  if (customName) {
    return customName;
  }

  const labels:
    Record<string, string> = {
      PAGE_VIEW:
        "Page View",

      VIEW_ITEM_LIST:
        "View Item List",

      VIEW_ITEM:
        "View Item",

      ADD_TO_CART:
        "Add to Cart",

      BEGIN_CHECKOUT:
        "Begin Checkout",

      ADD_SHIPPING_INFO:
        "Add Shipping Info",

      ADD_PAYMENT_INFO:
        "Add Payment Info",

      PURCHASE:
        "Purchase",

      LEAD:
        "Lead",

      SUBSCRIBE:
        "Subscribe",
    };

  const normalizedEvent =
    String(
      eventName || ""
    )
      .trim()
      .toUpperCase();

  const fallbackLabel =
    normalizedEvent
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map(
        (word) =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(" ");

  const eventLabel =
    labels[
      normalizedEvent
    ] ||
    fallbackLabel ||
    "Conversion";

  return `DH - ${eventLabel}`;
}

function extractIdFromResourceName(resourceName?: string) {
  const match = String(resourceName || "").match(/conversionActions\/(\d+)/);
  return match ? match[1] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTagDetails(action: unknown) {
  const actionRecord = isRecord(action) ? action : {};

  const rawTagSnippets =
    actionRecord.tagSnippets ?? actionRecord.tag_snippets;

  const tagSnippets = Array.isArray(rawTagSnippets)
    ? rawTagSnippets
    : [];

  const combined = JSON.stringify(tagSnippets);

  const sendToMatch =
    combined.match(/AW-(\d+)\/([A-Za-z0-9_-]+)/) ||
    combined.match(/send_to['"]?\s*[:=]\s*['"]AW-(\d+)\/([A-Za-z0-9_-]+)/);

  const awOnlyMatch = combined.match(/AW-(\d+)/);

  let resourceName: string | undefined;

  if (typeof actionRecord.resourceName === "string") {
    resourceName = actionRecord.resourceName;
  } else if (typeof actionRecord.resource_name === "string") {
    resourceName = actionRecord.resource_name;
  }

  const conversionId =
    sendToMatch?.[1] ||
    awOnlyMatch?.[1] ||
    extractIdFromResourceName(resourceName);

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
  query: string,
  loginCustomerId?: string
) {
  const cleanId = cleanCustomerId(customerId);
  const response = await fetch(
    `https://googleads.googleapis.com/${getApiVersion()}/customers/${cleanId}/googleAds:search`,
    {
      method: "POST",
      headers: getHeaders(
        accessToken,
        loginCustomerId
      ),
      body: JSON.stringify({ query }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestId =
      response.headers.get("request-id") ||
      response.headers.get(
        "x-google-request-id"
      );

    const message =
      formatGoogleAdsApiError(
        data,
        response.status,
        requestId
      );

    console.error(
      "[Google Ads Conversion API] Search failed",
      {
        customerId: cleanId,
        status: response.status,
        requestId,
        error: message,
      }
    );

    throw new Error(message);
  }

  return data?.results || [];
}

async function findConversionActionByName(
  accessToken: string,
  customerId: string,
  name: string,
  loginCustomerId?: string
): Promise<GoogleAdsConversionActionResult | null> {
  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.resource_name,
      conversion_action.category,
      conversion_action.status,
      conversion_action.origin,
      conversion_action.type,
      conversion_action.primary_for_goal,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.name = '${escapeGaql(name)}'
    LIMIT 1
  `;

  const results = await googleAdsSearch(
    accessToken,
    customerId,
    query,
    loginCustomerId
  );
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
    status: action.status,
    origin: action.origin,
    type: action.type,
    primaryForGoal:
      typeof action.primaryForGoal === "boolean"
        ? action.primaryForGoal
        : undefined,
    reused: true,
    conversionId: tagDetails.conversionId,
    conversionLabel: tagDetails.conversionLabel,
    tagSnippets: tagDetails.tagSnippets,
  };
}

async function findConversionActionByResourceName(
  accessToken: string,
  customerId: string,
  resourceName: string,
  loginCustomerId?: string
): Promise<GoogleAdsConversionActionResult | null> {
  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.resource_name,
      conversion_action.category,
      conversion_action.status,
      conversion_action.origin,
      conversion_action.type,
      conversion_action.primary_for_goal,
      conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.resource_name = '${escapeGaql(resourceName)}'
    LIMIT 1
  `;

  const results = await googleAdsSearch(
    accessToken,
    customerId,
    query,
    loginCustomerId
  );
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
    status: action.status,
    origin: action.origin,
    type: action.type,
    primaryForGoal:
      typeof action.primaryForGoal === "boolean"
        ? action.primaryForGoal
        : undefined,
    reused: false,
    conversionId: tagDetails.conversionId,
    conversionLabel: tagDetails.conversionLabel,
    tagSnippets: tagDetails.tagSnippets,
  };
}

async function updateConversionActionPrimaryRole(
  accessToken: string,
  customerId: string,
  resourceName: string,
  isPrimary: boolean,
  loginCustomerId?: string
) {
  const cleanId =
    cleanCustomerId(
      customerId
    );

  const endpoint =
    [
      "https://googleads.googleapis.com",
      getApiVersion(),
      "customers",
      cleanId,
      "conversionActions:mutate",
    ].join("/");

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

        headers:
          getHeaders(
            accessToken,
            loginCustomerId
          ),

        body:
          JSON.stringify({
            operations: [
              {
                updateMask:
                  "primaryForGoal",

                update: {
                  resourceName,

                  primaryForGoal:
                    isPrimary,
                },
              },
            ],
          }),
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    const requestId =
      response.headers.get(
        "request-id"
      ) ||
      response.headers.get(
        "x-google-request-id"
      );

    const message =
      formatGoogleAdsApiError(
        data,
        response.status,
        requestId
      );

    console.error(
      "[Google Ads Conversion API] Primary role update failed",
      {
        customerId:
          cleanId,

        conversionAction:
          resourceName,

        requestedPrimary:
          isPrimary,

        status:
          response.status,

        requestId,

        error:
          message,
      }
    );

    throw new Error(
      message
    );
  }
}


async function createConversionAction(
  accessToken: string,
  customerId: string,
  conversionName: string,
  eventName: string,
  conversionValueMode: ConversionValueMode = "dynamic",
  isPrimary = true,
  loginCustomerId?: string
) {
  const cleanId = cleanCustomerId(customerId);

  const response = await fetch(
    `https://googleads.googleapis.com/${getApiVersion()}/customers/${cleanId}/conversionActions:mutate`,
    {
      method: "POST",
      headers: getHeaders(
        accessToken,
        loginCustomerId
      ),
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
    const requestId =
      response.headers.get("request-id") ||
      response.headers.get(
        "x-google-request-id"
      );

    const message =
      formatGoogleAdsApiError(
        data,
        response.status,
        requestId
      );

    console.error(
      "[Google Ads Conversion API] Create failed",
      {
        customerId: cleanId,
        status: response.status,
        requestId,
        eventName,
        conversionName,
        loginCustomerId:
          process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
            ? cleanCustomerId(
                process.env
                  .GOOGLE_ADS_LOGIN_CUSTOMER_ID
              )
            : null,
        error: message,
      }
    );

    throw new Error(message);
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
  const conversionName =
    buildConversionName(
      input.baseName,
      input.eventName
    );

  const expectedCategory =
    categoryForEvent(
      input.eventName
    );

  const requestedPrimary =
    input.isPrimary !== false;

  const existing =
    await findConversionActionByName(
      input.accessToken,
      input.customerId,
      conversionName,
      input.loginCustomerId
    );

  const nameForCreation =
    conversionName;

  if (existing) {
    const existingStatus =
      String(
        existing.status || ""
      ).toUpperCase();

    const existingType =
      String(
        existing.type || ""
      ).toUpperCase();

    const existingCategory =
      String(
        existing.category || ""
      ).toUpperCase();

    const isCompatible =
      existingStatus === "ENABLED" &&
      existingType === "WEBPAGE" &&
      existingCategory ===
        expectedCategory;

    /*
     * Only reuse a healthy Google Ads WEBPAGE
     * conversion for the same goal category.
     */
    if (isCompatible) {
      if (
        existing.primaryForGoal !==
        requestedPrimary
      ) {
        await updateConversionActionPrimaryRole(
          input.accessToken,
          input.customerId,
          existing.resourceName,
          requestedPrimary,
          input.loginCustomerId
        );

        const refreshed =
          await findConversionActionByResourceName(
            input.accessToken,
            input.customerId,
            existing.resourceName,
            input.loginCustomerId
          );

        if (
          !refreshed ||
          String(
            refreshed.status || ""
          ).toUpperCase() !==
            "ENABLED"
        ) {
          throw new Error(
            "Google Ads conversion action was updated, but could not be verified as ENABLED."
          );
        }

        console.info(
          "[Google Ads Conversion API] Updated existing conversion goal role",
          {
            customerId:
              cleanCustomerId(
                input.customerId
              ),

            conversionActionId:
              refreshed.id,

            conversionName:
              refreshed.name,

            primaryForGoal:
              requestedPrimary,
          }
        );

        return {
          ...refreshed,
          reused: true,
        };
      }

      return existing;
    }

    /*
     * Do not silently reuse:
     *
     * - REMOVED
     * - HIDDEN
     * - UNKNOWN
     * - wrong conversion type
     * - wrong goal category
     *
     * The old name may still be reserved by Google,
     * therefore create a new unique action.
     */
    throw new Error(
      existingStatus === "REMOVED"
        ? `Google Ads already contains a removed conversion action named "${conversionName}". DH Conversions will not rename it automatically. Use another custom name, or resolve the old conversion action in Google Ads first.`
        : `Google Ads already contains a conversion action named "${conversionName}" that cannot be reused for this configuration. DH Conversions will not rename it automatically. Use another custom name.`
    );
  }

  const resourceName =
    await createConversionAction(
      input.accessToken,
      input.customerId,
      nameForCreation,
      input.eventName,
      input.conversionValueMode,
      requestedPrimary,
      input.loginCustomerId
    );

  const created =
    await findConversionActionByResourceName(
      input.accessToken,
      input.customerId,
      resourceName,
      input.loginCustomerId
    );

  if (created) {
    const createdStatus =
      String(
        created.status || ""
      ).toUpperCase();

    const createdType =
      String(
        created.type || ""
      ).toUpperCase();

    const createdCategory =
      String(
        created.category || ""
      ).toUpperCase();

    if (
      createdStatus !==
        "ENABLED" ||
      createdType !==
        "WEBPAGE" ||
      createdCategory !==
        expectedCategory
    ) {
      throw new Error(
        `Google Ads created conversion action ${created.id || created.name || resourceName}, but verification returned status=${created.status || "unknown"}, type=${created.type || "unknown"}, category=${created.category || "unknown"}.`
      );
    }

    if (
      created.primaryForGoal !==
      requestedPrimary
    ) {
      await updateConversionActionPrimaryRole(
        input.accessToken,
        input.customerId,
        created.resourceName,
        requestedPrimary,
        input.loginCustomerId
      );

      const refreshed =
        await findConversionActionByResourceName(
          input.accessToken,
          input.customerId,
          created.resourceName,
          input.loginCustomerId
        );

      if (!refreshed) {
        throw new Error(
          "Google Ads conversion was created, but its Primary/Secondary role could not be verified."
        );
      }

      return refreshed;
    }

    return created;
  }

  /*
   * Defensive fallback when mutate succeeds but
   * immediate search has not returned the action yet.
   */
  return {
    id:
      extractIdFromResourceName(
        resourceName
      ),

    name:
      nameForCreation,

    resourceName,

    category:
      expectedCategory,

    status:
      "ENABLED",

    origin:
      "WEBSITE",

    type:
      "WEBPAGE",

    primaryForGoal:
      requestedPrimary,

    reused:
      false,

    conversionId:
      cleanCustomerId(
        input.customerId
      ),

    conversionLabel:
      undefined,

    tagSnippets:
      [],
  };
}
