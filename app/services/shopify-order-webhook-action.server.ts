import type { ActionFunctionArgs } from "react-router";
import {
  InvalidShopifyOrderWebhookError,
  persistVerifiedShopifyOrderWebhook,
} from "./shopify-order-webhook.server";

export type WebhookAuthenticator = (request: Request) => Promise<{
  shop: string;
  payload: Record<string, unknown>;
  webhookId?: string | null;
}>;

type WebhookPersister = typeof persistVerifiedShopifyOrderWebhook;

export function createOrdersCreateAction(
  authenticateWebhook: WebhookAuthenticator,
  persistWebhook: WebhookPersister = persistVerifiedShopifyOrderWebhook,
) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, payload, webhookId } = await authenticateWebhook(request);

    try {
      await persistWebhook({ shop, payload, webhookId });
      return new Response(null, { status: 200 });
    } catch (error) {
      if (error instanceof InvalidShopifyOrderWebhookError) {
        return new Response(error.message, { status: error.status });
      }

      return new Response("Webhook persistence temporarily unavailable.", {
        status: 503,
        headers: { "Retry-After": "30" },
      });
    }
  };
}
