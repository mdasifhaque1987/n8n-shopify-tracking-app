import db from "../db.server";

/**
 * Get settings for a specific shop
 */
export async function getShopSettings(shop) {
  if (!shop) return null;

  return db.shopSettings.findUnique({
    where: { shop },
  });
}

/**
 * Create or update settings for a specific shop
 */
export async function upsertShopSettings(shop, data) {
  if (!shop) throw new Error("Shop domain is required");

  return db.shopSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}
