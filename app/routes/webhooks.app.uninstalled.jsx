import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const {
    shop,
    topic,
  } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  /*
   * Uninstall deliveries can be repeated and can arrive after
   * a session has already been removed, so deleteMany keeps
   * this operation idempotent.
   *
   * Full shop data removal is handled by shop/redact.
   */
  await db.session.deleteMany({
    where: { shop },
  });

  return new Response(null, {
    status: 200,
  });
};
