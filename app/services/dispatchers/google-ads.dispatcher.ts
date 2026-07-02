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

function getLoginCustomerId() {
  return cleanCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "");
}

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
    stringValue(ecommerce.transaction_id) ||
    stringValue(ecommerce.order_id);

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

export async function dispatchPurchaseToGoogleAds(
  event: NormalizedTrackingEvent,
  workspaceId: string
): Promise<GoogleAdsDispatchResult> {
  try {
    if (process.env.GOOGLE_ADS_SERVER_PURCHASE_ENABLED !== "true") {
      return {
        success: false,
        status: "skipped",
        message: "Google Ads server-side purchase sending is disabled.",
      };
    }

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
        message: "Skipped Google Ads server-side purchase because gclid, gbraid, and wbraid are missing.",
      };
    }

    const purchase = getPurchaseData(event);

    if (!purchase.transactionId) {
      return {
        success: false,
        status: "skipped",
        message: "Skipped Google Ads server-side purchase because transaction_id is missing.",
      };
    }

    if (purchase.value === null || !purchase.currency) {
      return {
        success: false,
        status: "skipped",
        message: "Skipped Google Ads server-side purchase because value or currency is missing.",
      };
    }

    const activeConfig = await db.googleConversionConfig.findFirst({
      where: {
        workspaceId,
        isActive: true,
        events: {
          has: "PURCHASE",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const preferredGoogleAdsCustomerId = cleanCustomerId(
      activeConfig?.googleAdsCustomerId
    );

    const conversionAction = await db.googleAdsConversionAction.findFirst({
      where: {
        workspaceId,
        eventName: "PURCHASE",
        isActive: true,
        ...(preferredGoogleAdsCustomerId
          ? { googleAdsCustomerId: preferredGoogleAdsCustomerId }
          : {}),
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!conversionAction) {
      return {
        success: false,
        status: "skipped",
        message: "Skipped Google Ads server-side purchase because active PURCHASE conversion action was not found.",
      };
    }

    const googleAdsCustomerId = cleanCustomerId(
      conversionAction.googleAdsCustomerId || activeConfig?.googleAdsCustomerId
    );

    if (!googleAdsCustomerId) {
      return {
        success: false,
        status: "skipped",
        message: "Skipped Google Ads server-side purchase because Google Ads customer ID is missing from PURCHASE conversion action.",
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

    const googleConnection = await getGooglePlatformConnection(workspaceId);

    if (!googleConnection) {
      return {
        success: false,
        status: "failed",
        message: "Google connection was not found for this workspace.",
      };
    }

    const accessToken = await resolveGoogleAccessToken(googleConnection);

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
      validateOnly: false,
    };

    const apiVersion = getGoogleAdsApiVersion();
    const endpoint = `https://googleads.googleapis.com/${apiVersion}/customers/${googleAdsCustomerId}:uploadClickConversions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    };

    const loginCustomerId = getLoginCustomerId();

    if (loginCustomerId) {
      headers["login-customer-id"] = loginCustomerId;
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
      message: "Google Ads server-side purchase sent successfully.",
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

export async function dispatchToGoogleAds(
  event: NormalizedTrackingEvent,
  workspaceId: string
): Promise<GoogleAdsDispatchResult> {
  return dispatchPurchaseToGoogleAds(event, workspaceId);
}
