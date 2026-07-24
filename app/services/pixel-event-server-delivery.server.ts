import db from "../db.server";
import {
  claimEventProcessing,
  releaseEventProcessing,
} from "../lib/utils/deduplication.server";
import { getAssetSelections } from "./asset-selection.server";
import { dispatchToGA4 } from "./dispatchers/ga4.dispatcher";
import { dispatchToMeta } from "./dispatchers/meta.dispatcher";
import { createEventDeliveryLog } from "./event-delivery-log.server";
import { getGa4DeliverySettings } from "./ga4-delivery-settings.server";
import type { NormalizedTrackingEvent } from "./normalize-event.server";
import { getShopEntitlements } from "./subscription.server";
import { getTestModeSettings } from "./test-mode.server";

type PlatformName = "ga4" | "meta";

type DispatchResult = {
  success: boolean;
  status: string;
  message: string;
  responsePayload?: Record<string, unknown>;
};

export type PixelServerDeliverySummary = {
  platform: PlatformName;
  status: "success" | "sent" | "failed" | "skipped";
  message: string;
};

export type PixelServerDeliveryResult = {
  deliveries: PixelServerDeliverySummary[];
  purchaseDeferredToOrderWebhook: boolean;
};

function text(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : String(value).trim();
}

function enabledValue(value: unknown): boolean {
  return text(value).toLowerCase() === "true";
}

function normalizeLogStatus(
  status: string,
): "success" | "sent" | "failed" | "skipped" {
  if (status === "success") return "success";
  if (status === "sent") return "sent";
  if (status === "skipped") return "skipped";

  return "failed";
}

function getClientIpAddress(request: Request): string | null {
  const candidateHeaders = [
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
  ];

  for (const headerName of candidateHeaders) {
    const value = text(request.headers.get(headerName));

    if (!value) continue;

    return value.split(",")[0]?.trim() || null;
  }

  return null;
}

function splitSelectedEvents(value: unknown): string[] {
  const normalized = text(value);

  if (!normalized || normalized === "none") {
    return [];
  }

  return normalized
    .split(",")
    .map((eventName) => eventName.trim())
    .filter(Boolean);
}

function getMetaEventName(
  event: NormalizedTrackingEvent,
): string {
  if (event.meta_event) {
    return text(event.meta_event);
  }

  const map: Record<string, string> = {
    page_view: "PageView",
    view_item_list: "ViewContentList",
    view_item: "ViewContent",
    view_cart: "ViewContent",
    add_to_cart: "AddToCart",
    remove_from_cart: "RemoveFromCart",
    begin_checkout: "InitiateCheckout",
    add_contact_info: "Lead",
    add_shipping_info: "AddShippingInfo",
    add_payment_info: "AddPaymentInfo",
    purchase: "Purchase",
    search: "Search",
    generate_lead: "Lead",
    sign_up: "CompleteRegistration",
  };

  return map[event.event_name] || event.event_name;
}

function isMetaEventSelected(
  selectedEvents: string[],
  event: NormalizedTrackingEvent,
): boolean {
  if (!selectedEvents.length) {
    return false;
  }

  const normalizedSelections = new Set(
    selectedEvents.map((eventName) =>
      eventName.toLowerCase(),
    ),
  );

  if (
    normalizedSelections.has("*") ||
    normalizedSelections.has("all")
  ) {
    return true;
  }

  const metaEventName =
    getMetaEventName(event).toLowerCase();

  return (
    normalizedSelections.has(metaEventName) ||
    normalizedSelections.has(
      event.event_name.toLowerCase(),
    )
  );
}

async function safelyWriteDeliveryLog(input: {
  workspaceId: string;
  shop: string;
  event: NormalizedTrackingEvent;
  platform: PlatformName;
  result: DispatchResult;
}): Promise<void> {
  try {
    await createEventDeliveryLog({
      workspaceId: input.workspaceId,
      shop: input.shop,
      event: input.event,
      platform: input.platform,
      deliveryType: "server",
      status: normalizeLogStatus(
        input.result.status,
      ),
      message: input.result.message,
      responsePayload:
        input.result.responsePayload || null,
    });
  } catch {
    console.error(
      "Pixel server delivery log failed",
      {
        platform: input.platform,
        eventName: input.event.event_name,
      },
    );
  }
}

async function runDelivery(input: {
  workspaceId: string;
  shop: string;
  event: NormalizedTrackingEvent;
  platform: PlatformName;
  dispatch: () => Promise<DispatchResult>;
}): Promise<PixelServerDeliverySummary> {
  const previousDelivery =
    await db.eventDeliveryLog.findFirst({
      where: {
        workspaceId: input.workspaceId,
        eventId: input.event.event_id,
        eventName: input.event.event_name,
        platform: input.platform,
        deliveryType: "server",
        status: {
          in: ["success", "sent"],
        },
      },
      select: {
        id: true,
      },
    });

  if (previousDelivery) {
    return {
      platform: input.platform,
      status: "skipped",
      message:
        `${input.platform.toUpperCase()} server event was already delivered.`,
    };
  }

  const deduplicationId = [
    "pixel-server",
    input.workspaceId,
    input.platform,
    input.event.event_name,
    input.event.event_id,
  ].join(":");

  const claimed =
    await claimEventProcessing(
      deduplicationId,
    );

  if (!claimed) {
    return {
      platform: input.platform,
      status: "skipped",
      message:
        `${input.platform.toUpperCase()} server event is already being processed.`,
    };
  }

  let result: DispatchResult;

  try {
    result = await input.dispatch();
  } catch (error) {
    result = {
      success: false,
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "Unexpected server delivery error.",
      responsePayload: {
        errorCategory:
          error instanceof Error
            ? error.name
            : "unknown_dispatch_error",
      },
    };
  }

  /*
   * A dispatcher is only invoked after this service has
   * confirmed that the platform should be enabled.
   *
   * Therefore, a dispatcher-level skipped result represents
   * configuration inconsistency and should be retried rather
   * than silently treated as successful.
   */
  if (result.status === "skipped") {
    result = {
      ...result,
      success: false,
      status: "failed",
      message:
        `${result.message} The configured server delivery was not completed.`,
    };
  }

  await safelyWriteDeliveryLog({
    workspaceId: input.workspaceId,
    shop: input.shop,
    event: input.event,
    platform: input.platform,
    result,
  });

  const normalizedStatus =
    normalizeLogStatus(
      result.status,
    );

  if (normalizedStatus === "failed") {
    await releaseEventProcessing(
      deduplicationId,
    );
  }

  return {
    platform: input.platform,
    status: normalizedStatus,
    message: result.message,
  };
}

export async function dispatchPixelEventToServerPlatforms(input: {
  request: Request;
  workspaceId: string;
  shop: string;
  event: NormalizedTrackingEvent;
}): Promise<PixelServerDeliveryResult> {
  /*
   * Purchase server delivery is handled by the authoritative
   * Shopify orders/create webhook and order worker.
   *
   * The browser Purchase is still sent by GA4 client mode
   * and/or Meta Pixel where those channels are enabled.
   */
  if (input.event.event_name === "purchase") {
    return {
      deliveries: [],
      purchaseDeferredToOrderWebhook: true,
    };
  }

  const [
    entitlements,
    ga4DeliverySettings,
    selectedAssets,
    testModeSettings,
  ] = await Promise.all([
    getShopEntitlements(input.shop),
    getGa4DeliverySettings(input.workspaceId),
    getAssetSelections(input.workspaceId),
    getTestModeSettings(input.workspaceId),
  ]);

  const ga4Setting =
    ga4DeliverySettings.setting;

  const ga4ServerEnabled = Boolean(
    entitlements.ga4ServerSide &&
      ga4Setting?.isActive &&
      ga4Setting.deliveryMode === "server" &&
      ga4Setting.serverSideEnabled,
  );

  const metaDatasetId = text(
    selectedAssets[
      "meta:Meta Dataset / Pixel"
    ],
  );

  const metaAccessToken = text(
    selectedAssets[
      "meta:Meta CAPI Access Token"
    ],
  );

  const metaServerEnabled = Boolean(
    entitlements.metaCapi &&
      enabledValue(
        selectedAssets[
          "meta:Meta Server Side Enabled"
        ],
      ) &&
      metaDatasetId &&
      metaAccessToken &&
      metaAccessToken !== "none",
  );

  const selectedMetaEvents =
    splitSelectedEvents(
      selectedAssets[
        "meta:Meta Selected Events"
      ],
    );

  const ga4ServerTestMode = Boolean(
    testModeSettings.channels[
      "ga4_server"
    ]?.effective.enabled,
  );

  const metaCapiTestMode = Boolean(
    testModeSettings.channels[
      "meta_capi"
    ]?.effective.enabled,
  );

  const clientIpAddress =
    getClientIpAddress(input.request);

  const clientUserAgent =
    text(
      input.request.headers.get(
        "user-agent",
      ),
    ) || null;

  const deliveryTasks: Array<
    Promise<PixelServerDeliverySummary>
  > = [];

  if (ga4ServerEnabled) {
    deliveryTasks.push(
      runDelivery({
        workspaceId: input.workspaceId,
        shop: input.shop,
        event: input.event,
        platform: "ga4",
        dispatch: () =>
          dispatchToGA4(
            input.event,
            input.workspaceId,
            {
              testMode:
                ga4ServerTestMode,
              debugMode:
                ga4ServerTestMode,
              validationOnly: false,
            },
          ),
      }),
    );
  }

  if (
    metaServerEnabled &&
    isMetaEventSelected(
      selectedMetaEvents,
      input.event,
    )
  ) {
    deliveryTasks.push(
      runDelivery({
        workspaceId: input.workspaceId,
        shop: input.shop,
        event: input.event,
        platform: "meta",
        dispatch: () =>
          dispatchToMeta(
            input.event,
            input.workspaceId,
            {
              testMode:
                metaCapiTestMode,
              clientIpAddress,
              clientUserAgent,
            },
          ),
      }),
    );
  }

  return {
    deliveries:
      await Promise.all(deliveryTasks),
    purchaseDeferredToOrderWebhook:
      false,
  };
}
