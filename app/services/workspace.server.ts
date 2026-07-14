import db from "../db.server";

function cleanShop(shopInput: string) {
  return shopInput
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function shopSlug(shop: string) {
  return `shop-${shop.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function getOrCreateShopWorkspace(shopInput: string) {
  const shop = cleanShop(shopInput);

  if (!shop) {
    throw new Error("Shop is required to create workspace");
  }

  const slug = shopSlug(shop);
  const ownerEmail = `${slug}@workspace.local`;

  const owner = await db.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: shop,
      emailVerified: true,
    },
  });

  const workspace = await db.workspace.upsert({
    where: { slug },
    update: {
      name: shop,
    },
    create: {
      name: shop,
      slug,
      ownerId: owner.id,
    },
  });

  await db.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: owner.id,
      },
    },
    update: {
      role: "OWNER",
    },
    create: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
    },
  });

  return workspace;
}
