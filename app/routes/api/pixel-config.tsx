// API endpoint to return pixel configuration for storefront
import type { LoaderFunctionArgs } from "react-router";
import { getShopSettings } from "../../../models/shop-settings.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({ error: "Shop parameter required" }, { status: 400 });
  }

  try {
    const settings = await getShopSettings(shop);
    
    return Response.json({
      pixels: {
        ga4Id: settings?.ga4Id || null,
        googleAdsId: settings?.googleAdsId || null,
        facebookPixelId: settings?.facebookPixelId || null,
        tiktokPixelId: settings?.tiktokPixelId || null,
        pinterestTagId: settings?.pinterestTagId || null,
        linkedinPid: settings?.linkedinPid || null,
        bingUetTagId: settings?.bingUetTagId || null,
      },
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('[Pixel Config API] Error:', error);
    return Response.json({ error: "Failed to load configuration" }, { status: 500 });
  }
}
