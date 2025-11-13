// app/models/shop-settings.server.ts
import db from "../db.server";

export async function getShopSettings(shop: string) {
  return db.shopSettings.findUnique({
    where: { shop },
  });
}

export async function upsertShopSettings(
  shop: string,
  data: {
    ga4Id?: string | null;
    googleAdsId?: string | null;
    facebookPixelId?: string | null;
    tiktokPixelId?: string | null;
    pinterestTagId?: string | null;
    linkedinPid?: string | null;
    bingUetTagId?: string | null;
  }
) {
  return db.shopSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}
