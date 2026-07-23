import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { getShopSettings } from "../models/shop-settings.server";
import { getGa4DeliverySettings } from "../services/ga4-delivery-settings.server";
import { getAssetSelections } from "../services/asset-selection.server";
import { getTestModeSettings } from "../services/test-mode.server";
import { getShopEntitlements } from "../services/subscription.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};

export async function action() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function cleanCustomerId(value: string | null | undefined) {
  return String(value || "").replace(/-/g, "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json(
      { error: "Shop parameter required" },
      { status: 400, headers: corsHeaders }
    );
  }

  const settings = await getShopSettings(shop);
  const entitlements = await getShopEntitlements(shop);

  let ga4MeasurementId = settings?.ga4Id || null;
  let ga4DeliveryMode = "client";
  let ga4ClientSideEnabled = Boolean(ga4MeasurementId);
  let ga4ServerSideEnabled = false;
  let testModeEnabled = false;
  let ga4ClientTestMode = false;
  let metaPixelTestMode = false;

  const googleAdsConversions: Record<string, unknown> = {};
  const googleAdsMissingLabels: string[] = [];
  let googleAdsRemarketing: Record<string, unknown> = {
    enabled: false,
    deliveryMode: "client",
    events: [],
    itemIdFormat: "shopify_country_product_variant",
  };

  let metaConfig: Record<string, unknown> = {
    enabled: false,
    datasetId: null,
    pixelId: null,
    clientSideEnabled: false,
    serverSideEnabled: false,
    selectedEvents: [],
    testEventCode: "",
    contentIdFormat: "shopify_country_product_variant",
    capiAccessTokenConfigured: false,
  };

  if (settings?.workspaceId) {
    const ga4DeliverySettings = await getGa4DeliverySettings(settings.workspaceId);
    const testModeSettings = await getTestModeSettings(settings.workspaceId);
    testModeEnabled = Boolean(testModeSettings?.enabled);
    ga4ClientTestMode = Boolean(testModeSettings.channels.ga4_client.effective.enabled);
    metaPixelTestMode = Boolean(testModeSettings.channels.meta_pixel.effective.enabled);

    if (ga4DeliverySettings.setting?.isActive) {
      ga4DeliveryMode = ga4DeliverySettings.setting.deliveryMode || "client";
      ga4ClientSideEnabled = Boolean(ga4DeliverySettings.setting.clientSideEnabled);
      ga4ServerSideEnabled = Boolean(
        entitlements.ga4ServerSide && ga4DeliverySettings.setting.serverSideEnabled
      );
    }

    if (ga4DeliverySettings.credential?.assetId) {
      ga4MeasurementId = ga4DeliverySettings.credential.assetId;
    }

    const selectedAssets = await getAssetSelections(settings.workspaceId);

    const metaDatasetId = String(
      selectedAssets["meta:Meta Dataset / Pixel"] || ""
    ).trim();

    const metaSelectedEventsRaw = String(
      selectedAssets["meta:Meta Selected Events"] || "none"
    ).trim();

    const metaSelectedEvents =
      metaSelectedEventsRaw === "none"
        ? []
        : metaSelectedEventsRaw
            .split(",")
            .map((eventName) => eventName.trim())
            .filter(Boolean);

    const metaClientSideEnabled =
      String(selectedAssets["meta:Meta Client Side Enabled"] || "false") === "true";

    const metaServerSideEnabled =
      String(selectedAssets["meta:Meta Server Side Enabled"] || "false") === "true";

    const metaContentIdFormat = String(
      selectedAssets["meta:Meta Content ID Format"] ||
        "shopify_country_product_variant"
    ).trim();

    const metaCapiAccessTokenConfigured = Boolean(
      String(selectedAssets["meta:Meta CAPI Access Token"] || "").trim()
    );

    metaConfig = {
      enabled: Boolean(metaDatasetId && (metaClientSideEnabled || metaServerSideEnabled)),
      datasetId: metaDatasetId || null,
      pixelId: metaDatasetId || null,
      clientSideEnabled: metaClientSideEnabled,
      serverSideEnabled: Boolean(
        entitlements.metaCapi && metaServerSideEnabled && metaCapiAccessTokenConfigured
      ),
      selectedEvents: metaSelectedEvents,
      testEventCodeConfigured: Boolean(selectedAssets["meta:Meta Test Event Code"] && selectedAssets["meta:Meta Test Event Code"] !== "none"),
      contentIdFormat: metaContentIdFormat,
      capiAccessTokenConfigured: metaCapiAccessTokenConfigured,
      testMode: metaPixelTestMode,
    };

    const selectedGoogleAdsCustomerId =
      String(
        selectedAssets["google:Google Ads Account / Manager Account"] ||
          selectedAssets["GOOGLE_ADS:Google Ads Account / Manager Account"] ||
          selectedAssets["google:Google Ads Account"] ||
          selectedAssets["GOOGLE_ADS:Google Ads Account"] ||
          ""
      )
        .replace(/-/g, "")
        .trim();

    const remarketingEnabled =
      String(selectedAssets["google:Google Ads Remarketing"] || "") === "enabled";

    const remarketingEvents = String(
      selectedAssets["google:Google Ads Remarketing:events"] || ""
    )
      .split(",")
      .map((eventName) => eventName.trim())
      .filter(Boolean);

    const remarketingItemIdFormat = String(
      selectedAssets["google:Google Ads Remarketing:item_id_format"] ||
        selectedAssets["google:Google Ads Account / Manager Account:item_id_format"] ||
        "shopify_country_product_variant"
    );

    const remarketingConversionAction = selectedGoogleAdsCustomerId
      ? await db.googleAdsConversionAction.findFirst({
          where: {
            workspaceId: settings.workspaceId,
            googleAdsCustomerId: selectedGoogleAdsCustomerId,
            isActive: true,
            conversionId: {
              not: null,
            },
          },
          select: {
            conversionId: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
        })
      : null;

    const remarketingConversionId = cleanCustomerId(
      remarketingConversionAction?.conversionId
    );

    googleAdsRemarketing = {
      enabled: Boolean(
        remarketingEnabled &&
          selectedGoogleAdsCustomerId &&
          remarketingConversionId
      ),
      conversionId: remarketingConversionId || null,
      googleAdsCustomerId: selectedGoogleAdsCustomerId || null,
      deliveryMode: "client",
      events: remarketingEvents,
      itemIdFormat: remarketingItemIdFormat,
    };

    const googleAdsActions = selectedGoogleAdsCustomerId
      ? await db.googleAdsConversionAction.findMany({
          where: {
            workspaceId: settings.workspaceId,
            googleAdsCustomerId: selectedGoogleAdsCustomerId,
            isActive: true,
            deliveryMode: "client",
          },
          select: {
            eventName: true,
            conversionName: true,
            googleAdsCustomerId: true,
            conversionId: true,
            conversionLabel: true,
            conversionActionId: true,
            isPrimary: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
        })
      : [];

    for (const action of googleAdsActions) {
      const conversionId =
        cleanCustomerId(action.conversionId) ||
        cleanCustomerId(action.googleAdsCustomerId);

      if (!conversionId || !action.conversionLabel) {
        googleAdsMissingLabels.push(action.eventName);
        continue;
      }

      if (!Array.isArray(googleAdsConversions[action.eventName])) {
        googleAdsConversions[action.eventName] = [];
      }

      (googleAdsConversions[action.eventName] as unknown[]).push({
        eventName: action.eventName,
        conversionName: action.conversionName,
        conversionId,
        conversionLabel: action.conversionLabel,
        conversionActionId: action.conversionActionId,
        isPrimary: action.isPrimary,
      });
    }
  }

  return Response.json(
    {
      testMode: testModeEnabled,
      ga4: {
        enabled: Boolean(ga4MeasurementId) && ga4DeliveryMode === "client" && ga4ClientSideEnabled,
        measurementId: ga4MeasurementId,
        deliveryMode: ga4DeliveryMode,
        clientSideEnabled: ga4ClientSideEnabled,
        serverSideEnabled: ga4ServerSideEnabled,
        testMode: ga4ClientTestMode,
      },
      googleAds: {
        enabled: Object.keys(googleAdsConversions).length > 0,
        deliveryMode: "client",
        conversions: googleAdsConversions,
        remarketing: googleAdsRemarketing,
        missingLabels: googleAdsMissingLabels,
      },
      meta: metaConfig,
      pixels: {
        ga4Id: ga4MeasurementId,
        googleAdsId: settings?.googleAdsId || null,
        facebookPixelId:
          metaConfig.pixelId ||
          settings?.facebookPixelId ||
          null,
        tiktokPixelId: settings?.tiktokPixelId || null,
        pinterestTagId: settings?.pinterestTagId || null,
        linkedinPid: settings?.linkedinPid || null,
        bingUetTagId: settings?.bingUetTagId || null,
      },
    },
    { headers: corsHeaders }
  );
}
