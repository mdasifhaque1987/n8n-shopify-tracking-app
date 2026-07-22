import { authenticate } from "../shopify.server";
import { createOrdersCreateAction } from "../services/shopify-order-webhook-action.server";

export const action = createOrdersCreateAction(
  async (request) => {
    const result = await authenticate.webhook(request);
    return {
      shop: result.shop,
      payload: result.payload as Record<string, unknown>,
      webhookId: request.headers.get("x-shopify-webhook-id"),
    };
  },
);
