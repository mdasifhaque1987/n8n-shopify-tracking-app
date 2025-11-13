// app/routes/app.settings.tsx
import type { LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Make sure only authenticated admin users can access this route
  await authenticate.admin(request);
  return null;
}

export default function SettingsPage() {
  return (
    <div style={{ padding: "16px" }}>
      <h1>DH Tracking App – Settings</h1>
      <p>
        This is a placeholder for your tracking configuration (GA4, Google Ads,
        Facebook Pixel, etc.). We’ll turn this into a real form next.
      </p>
      <p>
        Use the left nav or{" "}
        <Link to="/app">go back to the app home page</Link>.
      </p>
    </div>
  );
}
