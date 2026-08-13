import shopify from "../../app/shopify.server";

const SHOP = "n8n-tracking-app.myshopify.com";

async function main() {
  try {
    const { admin } =
      await shopify.unauthenticated.admin(SHOP);

    const response = await admin.graphql(`
      #graphql
      query WebhookSubscriptions {
        webhookSubscriptions(first: 100) {
          nodes {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    `);

    const json = (await response.json()) as {
      data?: {
        webhookSubscriptions?: {
          nodes?: Array<{
            id?: string;
            topic?: string;
            endpoint?: {
              __typename?: string;
              callbackUrl?: string;
            };
          }>;
        };
      };
      errors?: unknown;
    };

    if (json.errors) {
      console.log("GRAPHQL ERRORS:");
      console.dir(json.errors, { depth: null });
      process.exitCode = 1;
      return;
    }

    const nodes =
      json?.data?.webhookSubscriptions?.nodes || [];

    console.log();
    console.log("ALL REGISTERED WEBHOOKS:");
    console.dir(nodes, { depth: null });

    const orderWebhooks =
      nodes.filter(
        (item: any) =>
          String(item.topic || "").toUpperCase() ===
          "ORDERS_CREATE"
      );

    console.log();
    console.log("ORDERS_CREATE WEBHOOKS:");
    console.dir(orderWebhooks, { depth: null });

    console.log();
    console.log("SUMMARY:");
    console.log({
      totalWebhooks: nodes.length,
      ordersCreateCount:
        orderWebhooks.length,
      correctOrdersCreateEndpoint:
        orderWebhooks.some(
          (item: any) =>
            item?.endpoint?.callbackUrl ===
            "https://tracking.datahatches.com/webhooks/orders-create"
        ),
    });
  } catch (error) {
    console.error(
      "WEBHOOK CHECK FAILED:",
      error instanceof Error
        ? error.stack || error.message
        : error
    );

    process.exitCode = 1;
  }
}

main();
