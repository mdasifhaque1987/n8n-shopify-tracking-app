import { authenticate } from "../shopify.server";
import {
  redactCustomerData,
  redactShopData,
} from "../services/privacy-compliance.server";

function normalizeTopic(topic) {
  const value = String(topic || "")
    .trim()
    .toLowerCase();

  const topics = {
    customers_data_request: "customers/data_request",
    customers_redact: "customers/redact",
    shop_redact: "shop/redact",
  };

  return topics[value] || value;
}

export const action = async ({ request }) => {
  /*
   * authenticate.webhook verifies the Shopify HMAC before
   * any compliance operation is performed.
   */
  const {
    shop,
    payload,
    topic,
  } = await authenticate.webhook(request);

  const normalizedTopic = normalizeTopic(topic);

  try {
    if (normalizedTopic === "customers/data_request") {
      /*
       * DH Conversions does not persist raw customer email,
       * phone, name, or address in delivery logs.
       *
       * The webhook is acknowledged without logging its
       * customer payload.
       */
      console.info(
        `Compliance data request acknowledged for ${shop}`,
      );
    } else if (normalizedTopic === "customers/redact") {
      const result = await redactCustomerData(
        shop,
        payload,
      );

      console.info(
        "Customer compliance deletion completed",
        result,
      );
    } else if (normalizedTopic === "shop/redact") {
      const result = await redactShopData(shop);

      console.info(
        "Shop compliance deletion completed",
        result,
      );
    } else {
      console.warn(
        `Unsupported compliance topic received: ${topic}`,
      );
    }

    return new Response(null, {
      status: 200,
    });
  } catch (error) {
    console.error(
      `Compliance webhook processing failed for ${shop}`,
      error,
    );

    return new Response(
      "Compliance webhook processing failed",
      {
        status: 500,
      },
    );
  }
};
