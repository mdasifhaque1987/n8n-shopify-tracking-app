import { useLoaderData, Form } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  upsertShopSettings,
} from "../models/shop-settings.server";

// Load existing settings for this shop
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
}

// Handle form submit (save settings)
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    ga4Id: (formData.get("ga4Id") || "").toString().trim() || null,
    googleAdsId: (formData.get("googleAdsId") || "").toString().trim() || null,
    facebookPixelId:
      (formData.get("facebookPixelId") || "").toString().trim() || null,
    tiktokPixelId:
      (formData.get("tiktokPixelId") || "").toString().trim() || null,
    pinterestTagId:
      (formData.get("pinterestTagId") || "").toString().trim() || null,
    linkedinPid:
      (formData.get("linkedinPid") || "").toString().trim() || null,
    bingUetTagId:
      (formData.get("bingUetTagId") || "").toString().trim() || null,
  };

  await upsertShopSettings(session.shop, data);

  // React Router will revalidate loader, so we can just return null
  return null;
}

export default function SettingsPage() {
  const { settings } = useLoaderData();

  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <h1>DH Tracking Settings</h1>
      <p>
        Store all your tracking IDs here. We’ll use these values in your unified
        tracking pixel later.
      </p>

      <Form method="post">
        <fieldset style={{ border: "none", padding: 0, marginTop: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label>
              GA4 Measurement ID
              <br />
              <input
                name="ga4Id"
                defaultValue={settings?.ga4Id ?? ""}
                placeholder="G-XXXXXXXXXX"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              Google Ads Conversion ID
              <br />
              <input
                name="googleAdsId"
                defaultValue={settings?.googleAdsId ?? ""}
                placeholder="AW-XXXXXXXXX"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              Facebook Pixel ID
              <br />
              <input
                name="facebookPixelId"
                defaultValue={settings?.facebookPixelId ?? ""}
                placeholder="123456789012345"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              TikTok Pixel ID
              <br />
              <input
                name="tiktokPixelId"
                defaultValue={settings?.tiktokPixelId ?? ""}
                placeholder="ABCDEFG123456789"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              Pinterest Tag ID
              <br />
              <input
                name="pinterestTagId"
                defaultValue={settings?.pinterestTagId ?? ""}
                placeholder="1234567890123"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              LinkedIn Partner ID
              <br />
              <input
                name="linkedinPid"
                defaultValue={settings?.linkedinPid ?? ""}
                placeholder="1234567"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>
              Bing / Microsoft Ads UET Tag ID
              <br />
              <input
                name="bingUetTagId"
                defaultValue={settings?.bingUetTagId ?? ""}
                placeholder="123456789"
                style={{ width: "100%", padding: 8 }}
              />
            </label>
          </div>
        </fieldset>

        <button
          type="submit"
          style={{
            marginTop: 16,
            padding: "8px 16px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
          }}
        >
          Save settings
        </button>
      </Form>
    </div>
  );
}
