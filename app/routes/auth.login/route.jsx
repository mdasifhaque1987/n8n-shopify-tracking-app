import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  await login(request);
  return null;
};

export default function Auth() {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section>
          <s-paragraph>
            DH Conversions must be installed and opened from Shopify Admin or the
            Shopify App Store.
          </s-paragraph>
          <a href="https://admin.shopify.com">Open Shopify Admin</a>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
