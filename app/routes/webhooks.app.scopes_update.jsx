import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const {
    payload,
    topic,
    shop,
  } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const currentScopes = Array.isArray(payload.current)
    ? payload.current.join(",")
    : String(payload.current || "");

  await db.session.updateMany({
    where: { shop },
    data: {
      scope: currentScopes,
    },
  });

  return new Response(null, {
    status: 200,
  });
};
