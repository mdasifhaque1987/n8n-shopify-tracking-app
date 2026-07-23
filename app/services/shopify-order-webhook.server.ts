import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { encryptToken } from "../lib/encryption.server";
import { getShopifyCheckoutIdentity } from "./shopify-checkout-correlation.server";
import { getTestModeSettings } from "./test-mode.server";

export const ORDER_DELIVERY_PLATFORMS = ["google_ads", "ga4", "meta"] as const;
export type OrderDeliveryPlatform = typeof ORDER_DELIVERY_PLATFORMS[number];

type OrderPayload = Record<string, unknown>;

export type MinimizedOrderSnapshot = {
  orderId: string;
  createdAt: string | null;
  currency: string;
  value: number;
  tax: number | null;
  shipping: number | null;
  items: Array<{
    itemId: string;
    productId: string;
    variantId: string;
    sku: string;
    itemName: string;
    itemBrand: string;
    itemCategory: string;
    itemVariant: string;
    price: number | null;
    discount: number;
    quantity: number;
  }>;
};

type MinimizedCustomerData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  customerId?: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
};

export class InvalidShopifyOrderWebhookError extends Error {
  status = 400;

  constructor(message = "Shopify order identifier is missing.") {
    super(message);
    this.name = "InvalidShopifyOrderWebhookError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function amount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundMoney(value: number): number {
  return Number(Math.max(0, value).toFixed(6));
}

function lineDiscountTotal(item: Record<string, unknown>): number {
  const allocations = Array.isArray(item.discount_allocations)
    ? item.discount_allocations
    : [];

  const allocationTotal = roundMoney(
    allocations.reduce((sum, rawAllocation) => {
      const allocation = record(rawAllocation);
      const amountSet = record(allocation.amount_set);
      const shopMoney = record(amountSet.shop_money);

      return sum + (
        amount(
          allocation.amount ??
          shopMoney.amount
        ) || 0
      );
    }, 0),
  );

  if (allocationTotal > 0) {
    return allocationTotal;
  }

  const directDiscount = amount(
    item.total_discount ??
    item.current_total_discount
  );

  return directDiscount !== null
    ? roundMoney(directDiscount)
    : 0;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined && child !== ""),
  ) as T;
}

export function minimizeVerifiedShopifyOrder(payload: OrderPayload): {
  snapshot: MinimizedOrderSnapshot;
  customer: MinimizedCustomerData | null;
} {
  const orderId = text(payload.id);
  if (!orderId || orderId.length > 64 || !/^\d+$/.test(orderId)) {
    throw new InvalidShopifyOrderWebhookError();
  }

  const priceSet = record(payload.current_total_price_set || payload.total_price_set);
  const shopMoney = record(priceSet.shop_money);
  const currency = text(shopMoney.currency_code || payload.currency || payload.presentment_currency);
  const value = amount(shopMoney.amount ?? payload.current_total_price ?? payload.total_price);

  if (!currency || value === null) {
    throw new InvalidShopifyOrderWebhookError("Shopify order value or currency is missing.");
  }

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items.slice(0, 100) : [];
  const items = lineItems.map((rawItem) => {
    const item = record(rawItem);
    const quantity = amount(item.quantity) || 1;
    const originalUnitPrice = amount(item.price);
    const totalDiscount = lineDiscountTotal(item);
    const unitDiscount = roundMoney(totalDiscount / quantity);
    const finalUnitPrice =
      originalUnitPrice === null
        ? null
        : roundMoney(
            Math.max(
              0,
              originalUnitPrice - unitDiscount,
            ),
          );

    return {
      itemId: text(
        item.variant_id ||
        item.product_id ||
        item.id,
      ),
      productId: text(item.product_id),
      variantId: text(item.variant_id),
      sku: text(item.sku).slice(0, 255),
      itemName: text(
        item.title ||
        item.name,
      ).slice(0, 500),
      itemBrand: text(
        item.vendor ||
        item.brand,
      ).slice(0, 255),
      itemCategory: text(
        item.product_type ||
        item.category,
      ).slice(0, 255),
      itemVariant: text(
        item.variant_title ||
        item.variant_name,
      ).slice(0, 255),
      price: finalUnitPrice,
      discount: unitDiscount,
      quantity,
    };
  }).filter((item) => item.itemId);

  const customer = record(payload.customer);
  const billingAddress = record(payload.billing_address);
  const shippingAddress = record(payload.shipping_address);
  const address = Object.keys(shippingAddress).length ? shippingAddress : billingAddress;
  const minimizedAddress = compactObject({
    address1: text(address.address1) || undefined,
    address2: text(address.address2) || undefined,
    city: text(address.city) || undefined,
    state: text(address.province_code || address.province) || undefined,
    zip: text(address.zip) || undefined,
    country: text(address.country_code || address.country) || undefined,
  });
  const minimizedCustomer = compactObject({
    email: text(payload.email || customer.email) || undefined,
    phone: text(payload.phone || customer.phone || address.phone) || undefined,
    firstName: text(customer.first_name || address.first_name) || undefined,
    lastName: text(customer.last_name || address.last_name) || undefined,
    customerId: text(customer.id) || undefined,
    address: Object.keys(minimizedAddress).length ? minimizedAddress : undefined,
  });

  return {
    snapshot: {
      orderId,
      createdAt: text(payload.created_at).slice(0, 64) || null,
      currency,
      value,
      tax: amount(payload.current_total_tax ?? payload.total_tax),
      shipping: amount(record(record(payload.total_shipping_price_set).shop_money).amount),
      items,
    },
    customer: Object.keys(minimizedCustomer).length ? minimizedCustomer : null,
  };
}

export type WebhookPersistenceDependencies = {
  persist(input: {
    shop: string;
    orderId: string;
    webhookId: string | null;
    snapshot: MinimizedOrderSnapshot;
    encryptedCustomerData: string | null;
    encryptedTrackingIdentity?: string | null;
    testSnapshots?: Partial<Record<OrderDeliveryPlatform, { testMode: boolean; testModeSource: string; testMechanism: string; validationOnly: boolean; encryptedTestCode?: string | null }>>;
  }): Promise<{ jobId: string }>;
};

const defaultPersistence: WebhookPersistenceDependencies = {
  async persist(input) {
    return db.$transaction(async (tx: Prisma.TransactionClient) => {
      const job = await tx.shopifyOrderJob.upsert({
        where: { shop_orderId: { shop: input.shop, orderId: input.orderId } },
        create: {
          shop: input.shop,
          orderId: input.orderId,
          webhookId: input.webhookId,
          orderSnapshot: input.snapshot as unknown as Prisma.InputJsonValue,
          encryptedCustomerData: input.encryptedCustomerData,
          encryptedTrackingIdentity:
            input.encryptedTrackingIdentity || null,
        },
        update: {
          webhookId: input.webhookId,
          orderSnapshot: input.snapshot as unknown as Prisma.InputJsonValue,
          encryptedCustomerData: input.encryptedCustomerData,
          encryptedTrackingIdentity:
            input.encryptedTrackingIdentity || null,
        },
        select: { id: true },
      });

      await tx.shopifyOrderPlatformDelivery.createMany({
        data: ORDER_DELIVERY_PLATFORMS.map((platform) => ({
          jobId: job.id,
          shop: input.shop,
          orderId: input.orderId,
          platform,
          ...(input.testSnapshots?.[platform] || {}),
        })),
        skipDuplicates: true,
      });

      return { jobId: job.id };
    });
  },
};

export async function persistVerifiedShopifyOrderWebhook(
  input: {
    shop: string;
    payload: OrderPayload;
    webhookId?: string | null;
  },
  dependencies: WebhookPersistenceDependencies = defaultPersistence,
) {
  const minimized = minimizeVerifiedShopifyOrder(input.payload);
  const encryptedCustomerData = minimized.customer
    ? encryptToken(JSON.stringify(minimized.customer))
    : null;

  const checkoutToken = text(
    input.payload.checkout_token ||
    input.payload.checkoutToken,
  ).slice(0, 512);

  const checkoutIdentity =
    checkoutToken
      ? await getShopifyCheckoutIdentity(
          input.shop,
          checkoutToken,
        )
      : null;

  const encryptedTrackingIdentity =
    checkoutIdentity
      ? encryptToken(
          JSON.stringify(
            checkoutIdentity,
          ),
        )
      : null;

  let testSnapshots: Parameters<WebhookPersistenceDependencies["persist"]>[0]["testSnapshots"] = {};
  const shopSettings = dependencies === defaultPersistence
    ? await db.shopSettings.findUnique({ where: { shop: input.shop }, select: { workspaceId: true } })
    : null;
  if (shopSettings?.workspaceId) {
    const settings = await getTestModeSettings(shopSettings.workspaceId);
    const channelByPlatform = { google_ads: "google_ads_server", ga4: "ga4_server", meta: "meta_capi" } as const;
    const metaCode = await db.shopAssetSelection.findUnique({
      where: { workspaceId_platform_assetType: { workspaceId: shopSettings.workspaceId, platform: "meta", assetType: "Meta Test Event Code" } },
      select: { assetValue: true },
    });
    testSnapshots = Object.fromEntries(ORDER_DELIVERY_PLATFORMS.map((platform) => {
      const effective = settings.channels[channelByPlatform[platform]].effective;
      return [platform, {
        testMode: effective.enabled,
        testModeSource: effective.source,
        testMechanism: effective.enabled ? effective.mechanism : "PRODUCTION",
        validationOnly: platform === "google_ads" && effective.enabled,
        encryptedTestCode: platform === "meta" && effective.enabled && metaCode?.assetValue?.startsWith("enc:v1:")
          ? metaCode.assetValue.slice(7)
          : null,
      }];
    })) as typeof testSnapshots;
  }

  return dependencies.persist({
    shop: input.shop,
    orderId: minimized.snapshot.orderId,
    webhookId: text(input.webhookId).slice(0, 255) || null,
    snapshot: minimized.snapshot,
    encryptedCustomerData,
    encryptedTrackingIdentity,
    testSnapshots,
  });
}
