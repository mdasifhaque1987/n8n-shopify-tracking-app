import type { LoaderFunctionArgs } from "react-router";
import { getShopSettings } from "../models/shop-settings.server";
import { getGa4DeliverySettings } from "../services/ga4-delivery-settings.server";

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
