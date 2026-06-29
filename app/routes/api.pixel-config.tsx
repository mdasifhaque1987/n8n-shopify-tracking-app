import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { getShopSettings } from "../models/shop-settings.server";
import { getGa4DeliverySettings } from "../services/ga4-delivery-settings.server";
import { getAssetSelections } from "../services/asset-selection.server";

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

  let ga4MeasurementId = settings?.ga4Id || null;
  let ga4DeliveryMode = "client";
  let ga4ClientSideEnabled = Boolean(ga4MeasurementId);
  let ga4ServerSideEnabled = false;

  const googleAdsConversions: Record<string, unknown> = {};
  const googleAdsMissingLabels: string[] = [];

  if (settings?.workspaceId) {
    const ga4DeliverySettings = await getGa4DeliverySettings(settings.workspaceId);

    if (ga4DeliverySettings.setting?.isActive) {
      ga4DeliveryMode = ga4DeliverySettings.setting.deliveryMode || "client";
      ga4ClientSideEnabled = Boolean(ga4DeliverySettings.setting.clientSideEnabled);
      ga4ServerSideEnabled = Boolean(ga4DeliverySettings.setting.serverSideEnabled);
    }

    if (ga4DeliverySettings.credential?.assetId) {
      ga4MeasurementId = ga4DeliverySettings.credential.assetId;
    }

    const selectedAssets = await getAssetSelections(settings.workspaceId);

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

      googleAdsConversions[action.eventName] = {
        eventName: action.eventName,
        conversionName: action.conversionName,
        conversionId,
        conversionLabel: action.conversionLabel,
        conversionActionId: action.conversionActionId,
      };
    }
  }

  return Response.json(
    {
      ga4: {
        enabled: Boolean(ga4MeasurementId) && ga4DeliveryMode === "client" && ga4ClientSideEnabled,
        measurementId: ga4MeasurementId,
        deliveryMode: ga4DeliveryMode,
        clientSideEnabled: ga4ClientSideEnabled,
        serverSideEnabled: ga4ServerSideEnabled,
      },
      googleAds: {
        enabled: Object.keys(googleAdsConversions).length > 0,
        deliveryMode: "client",
        conversions: googleAdsConversions,
        missingLabels: googleAdsMissingLabels,
      },
      pixels: {
        ga4Id: ga4MeasurementId,
        googleAdsId: settings?.googleAdsId || null,
        facebookPixelId: settings?.facebookPixelId || null,
        tiktokPixelId: settings?.tiktokPixelId || null,
        pinterestTagId: settings?.pinterestTagId || null,
        linkedinPid: settings?.linkedinPid || null,
        bingUetTagId: settings?.bingUetTagId || null,
      },
    },
    { headers: corsHeaders }
  );
}
