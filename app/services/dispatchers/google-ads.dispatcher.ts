import db from "../../db.server";
import type { NormalizedTrackingEvent } from "../normalize-event.server";
import { getGooglePlatformConnection } from "../platform-connection.server";
import { resolveGoogleAccessToken } from "../google-token.server";

type DispatchStatus = "success" | "failed" | "skipped";

type GoogleAdsDispatchResult = {
  success: boolean;
  status: DispatchStatus;
  message: string;
  responsePayload?: Record<string, unknown>;
};

type ClickIdentifier =
  | { field: "gclid"; value: string }
  | { field: "gbraid"; value: string }
  | { field: "wbraid"; value: string };

function cleanCustomerId(value?: string | null) {
  return String(value || "").replace(/-/g, "").trim();
}

function getGoogleAdsApiVersion() {
  return process.env.GOOGLE_ADS_API_VERSION || "v24";
}

function getDeveloperToken() {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
}

async function getSelectedGoogleAdsCustomerId(
  workspaceId: string
) {
  /*
   * The Google Ads account selected in Configuration is the
   * authoritative destination boundary for this workspace.
   *
   * Never infer the destination account from an older conversion
   * config or from whichever active conversion action happens to
   * have been updated most recently.
   */
  const selection = await db.shopAssetSelection.findUnique({
    where: {
      workspaceId_platform_assetType: {
        workspaceId,
        platform: "google",
        assetType:
          "Google Ads Account / Manager Account",
      },
    },
    select: {
      assetValue: true,
    },
  });

  return cleanCustomerId(
    selection?.assetValue || ""
  );
}

async function getLoginCustomerId(workspaceId: string) {
  /*
   * Google Ads login-customer-id belongs to the merchant/workspace,
   * not to the application globally.
   *
   * Direct accounts are stored as "none".
   * MCC child accounts store the discovered manager customer ID.
   */
  const selection = await db.shopAssetSelection.findUnique({
    where: {
      workspaceId_platform_assetType: {
        workspaceId,
        platform: "google",
        assetType: "Google Ads Login Customer ID",
      },
    },
    select: {
      assetValue: true,
    },
  });

  const savedValue = String(
    selection?.assetValue || ""
  ).trim();

  if (
    !savedValue ||
    savedValue.toLowerCase() === "none"
  ) {
    return "";
  }

  return cleanCustomerId(savedValue);
}

function getServerApiMode() {
  return process.env.GOOGLE_ADS_SERVER_API || "data_manager";
}

function getDataManagerValidateOnly() {
  return process.env.GOOGLE_ADS_DATA_MANAGER_VALIDATE_ONLY === "true";
}

type PurchaseConversionActionRecord = {
  id?: string;
  googleAdsCustomerId: string;
  eventName: string;
  conversionName: string;
  conversionActionId?: string | null;
  conversionId?: string | null;
  conversionLabel?: string | null;
  resourceName: string;
  category?: string | null;
  deliveryMode?: string | null;
  isPrimary?: boolean;
};

type GoogleAdsDispatchOptions = {
  validateOnly?: boolean;
  testMode?: boolean;
  conversionActionOverride?: PurchaseConversionActionRecord;
};

function stringValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function formatGoogleAdsDateTime(eventTime: number) {
  const seconds =
    typeof eventTime === "number" && Number.isFinite(eventTime)
      ? eventTime
      : Math.floor(Date.now() / 1000);

  return new Date(seconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "+00:00");
}

function formatRfc3339Timestamp(eventTime: number) {
  const seconds =
    typeof eventTime === "number" && Number.isFinite(eventTime)
      ? eventTime
      : Math.floor(Date.now() / 1000);

  return new Date(seconds * 1000).toISOString();
}

function getClickIdentifier(event: NormalizedTrackingEvent): ClickIdentifier | null {
  const attribution = event.attribution || {};

  const gclid = stringValue(attribution.gclid);
  const gbraid = stringValue(attribution.gbraid);
  const wbraid = stringValue(attribution.wbraid);

  if (gclid) return { field: "gclid", value: gclid };
  if (gbraid) return { field: "gbraid", value: gbraid };
  if (wbraid) return { field: "wbraid", value: wbraid };

  return null;
}

function getPurchaseData(event: NormalizedTrackingEvent) {
  const ecommerce = event.ecommerce || {};

  const transactionId =
    stringValue(ecommerce.transaction_id) || stringValue(ecommerce.order_id);

  const value = numberValue(ecommerce.value);
  const currency = stringValue(ecommerce.currency);

  return {
    transactionId,
    value,
    currency,
  };
}

function getConversionActionResourceName(data: {
  googleAdsCustomerId: string;
  resourceName?: string | null;
  conversionActionId?: string | null;
}) {
  if (data.resourceName) {
    return data.resourceName;
  }

  if (data.conversionActionId) {
    return `customers/${data.googleAdsCustomerId}/conversionActions/${data.conversionActionId}`;
  }

  return "";
}

function getConversionActionId(conversionAction: {
  conversionActionId?: string | null;
  resourceName?: string | null;
}) {
  const directId = stringValue(conversionAction.conversionActionId);

  if (directId) {
    return directId;
  }

  const resourceName = stringValue(conversionAction.resourceName);
  const match = resourceName.match(/conversionActions\/([^/]+)$/);

  return match?.[1] || "";
}

async function findPurchaseConversionAction(
  workspaceId: string,
  conversionActionOverride?: PurchaseConversionActionRecord
) {
  /*
   * The Google Ads customer explicitly selected by this shop is
   * always the authoritative destination.
   */
  const selectedGoogleAdsCustomerId =
    await getSelectedGoogleAdsCustomerId(
      workspaceId
    );

  if (!selectedGoogleAdsCustomerId) {
    return {
      activeConfig: null,
      conversionAction: null,
      googleAdsCustomerId: "",
    };
  }

  const activeConfig =
    await db.googleConversionConfig.findFirst({
      where: {
        workspaceId,
        googleAdsCustomerId:
          selectedGoogleAdsCustomerId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

  if (conversionActionOverride) {
    const overrideCustomerId =
      cleanCustomerId(
        conversionActionOverride.googleAdsCustomerId
      );

    if (
      overrideCustomerId !==
      selectedGoogleAdsCustomerId
    ) {
      return {
        activeConfig,
        conversionAction: null,
        googleAdsCustomerId: "",
      };
    }

    return {
      activeConfig,
      conversionAction:
        conversionActionOverride,
      googleAdsCustomerId:
        selectedGoogleAdsCustomerId,
    };
  }

  const conversionAction =
    await db.googleAdsConversionAction.findFirst({
      where: {
        workspaceId,
        googleAdsCustomerId:
          selectedGoogleAdsCustomerId,
        eventName: "PURCHASE",
        isActive: true,
        deliveryMode: "server",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

  return {
    activeConfig,
    conversionAction,
    googleAdsCustomerId:
      conversionAction
        ? selectedGoogleAdsCustomerId
        : "",
  };
}

async function findPurchaseConversionActions(
  workspaceId: string
) {
  const selectedGoogleAdsCustomerId =
    await getSelectedGoogleAdsCustomerId(
      workspaceId
    );

  if (!selectedGoogleAdsCustomerId) {
    return {
      activeConfig: null,
      conversionActions: [],
    };
  }

  const activeConfig =
    await db.googleConversionConfig.findFirst({
      where: {
        workspaceId,
        googleAdsCustomerId:
          selectedGoogleAdsCustomerId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

  const conversionActions =
    await db.googleAdsConversionAction.findMany({
      where: {
        workspaceId,
        googleAdsCustomerId:
          selectedGoogleAdsCustomerId,
        eventName: "PURCHASE",
        isActive: true,
        deliveryMode: "server",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

  return {
    activeConfig,
    conversionActions,
  };
}

async function getGoogleAccessToken(workspaceId: string) {
  const googleConnection = await getGooglePlatformConnection(workspaceId);

  if (!googleConnection) {
    throw new Error("Google connection was not found for this workspace.");
  }

  return resolveGoogleAccessToken(googleConnection);
}

async function dispatchPurchaseToGoogleAdsDataManager(
  event: NormalizedTrackingEvent,
  workspaceId: string,
  options: GoogleAdsDispatchOptions = {}
): Promise<GoogleAdsDispatchResult> {
  try {
    if (event.event_name !== "purchase") {
      return {
        success: false,
        status: "skipped",
        message: `Skipped non-purchase event: ${event.event_name}`,
      };
    }

    const clickIdentifier = getClickIdentifier(event);

    if (!clickIdentifier) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads Data Manager purchase because gclid, gbraid, and wbraid are missing.",
      };
    }

    const purchase = getPurchaseData(event);

    if (!purchase.transactionId) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads Data Manager purchase because transaction_id is missing.",
      };
    }

    if (purchase.value === null || !purchase.currency) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads Data Manager purchase because value or currency is missing.",
      };
    }

    const { conversionAction, googleAdsCustomerId } =
      await findPurchaseConversionAction(workspaceId, options.conversionActionOverride);

    if (!conversionAction) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads Data Manager purchase because active PURCHASE conversion action was not found.",
      };
    }

    if (!googleAdsCustomerId) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads Data Manager purchase because Google Ads customer ID is missing from PURCHASE conversion action.",
      };
    }

    const conversionActionId = getConversionActionId(conversionAction);

    if (!conversionActionId) {
      return {
        success: false,
        status: "failed",
        message: "Google Ads Data Manager PURCHASE conversion action ID is missing.",
      };
    }

    const accessToken = await getGoogleAccessToken(workspaceId);

    const savedLoginCustomerId =
      await getLoginCustomerId(workspaceId);

    const loginCustomerId =
      savedLoginCustomerId ||
      googleAdsCustomerId;

    const adIdentifiers: Record<string, string> = {};
    adIdentifiers[clickIdentifier.field] = clickIdentifier.value;

    const dataManagerEvent: Record<string, unknown> = {
      adIdentifiers,
      conversionValue: purchase.value,
      currency: purchase.currency,
      eventTimestamp: formatRfc3339Timestamp(event.event_time),
      transactionId: purchase.transactionId,
      eventSource: "WEB",
      eventName: "purchase",
      conversionCount: 1,
    };

    if (event.client_id) {
      dataManagerEvent.clientId = event.client_id;
    }

    const validateOnly = Boolean(
      options.validateOnly || options.testMode || getDataManagerValidateOnly()
    );

    const body: Record<string, unknown> = {
      destinations: [
        {
          operatingAccount: {
            accountType: "GOOGLE_ADS",
            accountId: googleAdsCustomerId,
          },
          loginAccount: {
            accountType: "GOOGLE_ADS",
            accountId: loginCustomerId,
          },
          productDestinationId: conversionActionId,
        },
      ],
      events: [dataManagerEvent],
    };
    if (validateOnly) body.validateOnly = true;

    const response = await fetch(
      "https://datamanager.googleapis.com/v1/events:ingest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const responsePayload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      return {
        success: false,
        status: "failed",
        message: `Google Data Manager events.ingest failed with HTTP ${response.status}.`,
        responsePayload,
      };
    }

    return {
      success: true,
      status: "success",
      message: validateOnly
        ? "Google Data Manager purchase validation succeeded."
        : "Google Data Manager purchase sent successfully.",
      responsePayload,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function dispatchPurchaseToGoogleAdsApi(
  event: NormalizedTrackingEvent,
  workspaceId: string,
  options: GoogleAdsDispatchOptions = {}
): Promise<GoogleAdsDispatchResult> {
  try {
    if (event.event_name !== "purchase") {
      return {
        success: false,
        status: "skipped",
        message: `Skipped non-purchase event: ${event.event_name}`,
      };
    }

    const developerToken = getDeveloperToken();

    if (!developerToken) {
      return {
        success: false,
        status: "failed",
        message: "GOOGLE_ADS_DEVELOPER_TOKEN is missing.",
      };
    }

    const clickIdentifier = getClickIdentifier(event);

    if (!clickIdentifier) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads server-side purchase because gclid, gbraid, and wbraid are missing.",
      };
    }

    const purchase = getPurchaseData(event);

    if (!purchase.transactionId) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads server-side purchase because transaction_id is missing.",
      };
    }

    if (purchase.value === null || !purchase.currency) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads server-side purchase because value or currency is missing.",
      };
    }

    const { conversionAction, googleAdsCustomerId } =
      await findPurchaseConversionAction(workspaceId, options.conversionActionOverride);

    if (!conversionAction) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads server-side purchase because active PURCHASE conversion action was not found.",
      };
    }

    if (!googleAdsCustomerId) {
      return {
        success: false,
        status: "skipped",
        message:
          "Skipped Google Ads server-side purchase because Google Ads customer ID is missing from PURCHASE conversion action.",
      };
    }

    const conversionActionResourceName = getConversionActionResourceName({
      googleAdsCustomerId,
      resourceName: conversionAction.resourceName,
      conversionActionId: conversionAction.conversionActionId,
    });

    if (!conversionActionResourceName) {
      return {
        success: false,
        status: "failed",
        message: "Google Ads PURCHASE conversion action resource name is missing.",
      };
    }

    const accessToken = await getGoogleAccessToken(workspaceId);

    const conversion: Record<string, unknown> = {
      conversionAction: conversionActionResourceName,
      conversionDateTime: formatGoogleAdsDateTime(event.event_time),
      conversionValue: purchase.value,
      currencyCode: purchase.currency,
      orderId: purchase.transactionId,
      customVariables: [],
    };

    conversion[clickIdentifier.field] = clickIdentifier.value;

    const body = {
      conversions: [conversion],
      partialFailure: true,
      validateOnly: Boolean(options.validateOnly || options.testMode),
    };

    const apiVersion = getGoogleAdsApiVersion();

    const endpoint = `https://googleads.googleapis.com/${apiVersion}/customers/${googleAdsCustomerId}:uploadClickConversions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    };

    const loginCustomerId =
      await getLoginCustomerId(workspaceId);

    if (loginCustomerId) {
      headers["login-customer-id"] =
        loginCustomerId;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const responsePayload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      return {
        success: false,
        status: "failed",
        message: `Google Ads uploadClickConversions failed with HTTP ${response.status}.`,
        responsePayload,
      };
    }

    if (responsePayload.partialFailureError) {
      return {
        success: false,
        status: "failed",
        message: "Google Ads uploadClickConversions returned partialFailureError.",
        responsePayload,
      };
    }

    return {
      success: true,
      status: "success",
      message: options.validateOnly || options.testMode
        ? "Google Ads server-side purchase validation succeeded."
        : "Google Ads server-side purchase sent successfully.",
      responsePayload,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function dispatchPurchaseToGoogleAds(
  event: NormalizedTrackingEvent,
  workspaceId: string,
  options: GoogleAdsDispatchOptions = {}
): Promise<GoogleAdsDispatchResult> {
  if (process.env.GOOGLE_ADS_SERVER_PURCHASE_ENABLED !== "true") {
    return {
      success: false,
      status: "skipped",
      message: "Google Ads server-side purchase sending is disabled.",
    };
  }

  const apiMode = getServerApiMode();
  const { conversionActions } = await findPurchaseConversionActions(workspaceId);

  if (!conversionActions.length) {
    return {
      success: false,
      status: "skipped",
      message:
        "Skipped Google Ads server-side purchase because no active server-side PURCHASE conversion actions were found.",
    };
  }

  const dispatchOne =
    apiMode === "google_ads_api"
      ? dispatchPurchaseToGoogleAdsApi
      : dispatchPurchaseToGoogleAdsDataManager;

  const results = [];

  for (const conversionAction of conversionActions) {
    const result = await dispatchOne(event, workspaceId, {
      ...options,
      conversionActionOverride: conversionAction,
    });

    results.push({
      conversionName: conversionAction.conversionName,
      conversionActionId:
        conversionAction.conversionActionId ||
        getConversionActionId(conversionAction),
      googleAdsCustomerId: conversionAction.googleAdsCustomerId,
      eventName: conversionAction.eventName,
      isPrimary: conversionAction.isPrimary,
      deliveryMode: conversionAction.deliveryMode,
      success: result.success,
      status: result.status,
      message: result.message,
      responsePayload: result.responsePayload,
    });
  }

  const successCount = results.filter((item) => item.success).length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;

  return {
    success: successCount > 0,
    status: successCount > 0 ? "success" : failedCount > 0 ? "failed" : "skipped",
    message:
      successCount > 0
        ? `Google Ads server-side purchase processed for ${successCount}/${results.length} conversion action(s).`
        : `Google Ads server-side purchase did not send. Failed: ${failedCount}, skipped: ${skippedCount}.`,
    responsePayload: {
      apiMode,
      conversionCount: results.length,
      successCount,
      failedCount,
      skippedCount,
      results,
    },
  };
}

export async function dispatchToGoogleAds(
  event: NormalizedTrackingEvent,
  workspaceId: string,
  options: GoogleAdsDispatchOptions = {}
): Promise<GoogleAdsDispatchResult> {
  return dispatchPurchaseToGoogleAds(event, workspaceId, options);
}
