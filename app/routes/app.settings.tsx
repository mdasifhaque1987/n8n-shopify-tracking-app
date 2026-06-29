import { useState } from "react";
import type { ReactNode } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveGoogleConversionConfig } from "../services/google-conversion-config.server";
import { saveAssetSelection, getAssetSelections } from "../services/asset-selection.server";
import { createOrReuseGoogleAdsConversionAction } from "../services/google-ads-conversion-action.server";
import { saveGoogleAdsConversionAction } from "../services/google-ads-conversion-action-map.server";
import { saveGa4DeliverySettings, getGa4DeliverySettings } from "../services/ga4-delivery-settings.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import {
  getPlatformConnection,
  getWorkspaceConnections,
} from "../services/platform-connection.server";
import {
  getGoogleAnalyticsProperties,
  getGoogleAnalyticsDataStreams,
  getGoogleAdsAccounts,
  getMerchantCenters,
} from "../services/oauth/google.server";

type AssetOption = {
  value: string;
  label: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const savedConnections = await getWorkspaceConnections(workspace.id);
  const savedAssetSelections = await getAssetSelections(workspace.id);
  const ga4DeliverySettings = await getGa4DeliverySettings(workspace.id);
  const savedGa4PropertyId = savedAssetSelections["google:GA4 Property"] || "";

  const getStatus = (platform: string) => {
    const connection = savedConnections.find(
      (item) => item.platform === platform && item.isActive
    );

    return {
      id: connection?.id || null,
      connected: Boolean(connection),
      accountName: connection?.accountName || connection?.accountId || null,
    };
  };

  const assets: {
    google: {
      ga4Properties: AssetOption[];
      ga4DataStreams: AssetOption[];
      googleAdsAccounts: AssetOption[];
      merchantCenters: AssetOption[];
    };
  } = {
    google: {
      ga4Properties: [],
      ga4DataStreams: [],
      googleAdsAccounts: [],
      merchantCenters: [],
    },
  };

  const googleConnection = savedConnections.find(
    (item) => item.platform === "GOOGLE_ADS" && item.isActive
  );

  if (googleConnection) {
    const decryptedGoogleConnection = await getPlatformConnection(googleConnection.id);

    if (decryptedGoogleConnection?.decryptedAccessToken) {
      const ga4Properties = await getGoogleAnalyticsProperties(
        decryptedGoogleConnection.decryptedAccessToken
      );

      const googleAdsAccounts = await getGoogleAdsAccounts(
        decryptedGoogleConnection.decryptedAccessToken
      );

      const merchantCenters = await getMerchantCenters(
        decryptedGoogleConnection.decryptedAccessToken
      );

      assets.google.ga4Properties = ga4Properties.map((property) => ({
        value: property.propertyId,
        label: `${property.displayName} (${property.propertyId})`,
      }));

      if (savedGa4PropertyId) {
        const ga4DataStreams = await getGoogleAnalyticsDataStreams(
          decryptedGoogleConnection.decryptedAccessToken,
          savedGa4PropertyId
        );

        assets.google.ga4DataStreams = ga4DataStreams.map((stream) => ({
          value: stream.measurementId,
          label: `${stream.displayName} (${stream.measurementId})`,
        }));
      }

      assets.google.googleAdsAccounts = googleAdsAccounts.map((account) => ({
        value: account.customerId,
        label: account.descriptiveName,
      }));

      assets.google.merchantCenters = merchantCenters.map((account) => ({
        value: account.merchantId,
        label: account.name,
      }));
    }
  }

  return {
    shop: session.shop,
    connections: {
      google: getStatus("GOOGLE_ADS"),
      meta: getStatus("META"),
      tiktok: getStatus("TIKTOK"),
      pinterest: getStatus("PINTEREST"),
      microsoft: getStatus("MICROSOFT_ADS"),
      linkedin: getStatus("LINKEDIN"),
    },
    assets,
    savedAssetSelections,
    ga4DeliverySettings,
  };
}


export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "save_asset_selection") {
    const platform = String(formData.get("platform") || "");
    const assetType = String(formData.get("assetType") || "");
    const assetValue = String(formData.get("assetValue") || "");
    const assetLabel = String(formData.get("assetLabel") || "");

    if (!platform || !assetType || !assetValue) {
      return Response.json(
        { ok: false, error: "Missing asset selection data" },
        { status: 400 }
      );
    }

    await saveAssetSelection({
      workspaceId: workspace.id,
      platform,
      assetType,
      assetValue,
      assetLabel,
    });

    return Response.json({
      ok: true,
      message: "Asset selection saved.",
    });
  }

  if (actionType === "save_ga4_delivery_settings") {
    const propertyId = String(formData.get("propertyId") || "");
    const measurementId = String(formData.get("measurementId") || "").trim();
    const rawDeliveryMode = String(formData.get("deliveryMode") || "client");
    const deliveryMode = rawDeliveryMode === "server" ? "server" : "client";
    const apiSecret = String(formData.get("apiSecret") || "").trim();

    if (!propertyId) {
      return Response.json(
        { ok: false, error: "Select a GA4 property first" },
        { status: 400 }
      );
    }

    if (!measurementId) {
      return Response.json(
        { ok: false, error: "GA4 Measurement ID is required. Example: G-XXXXXXXXXX" },
        { status: 400 }
      );
    }

    const existingGa4Settings = await getGa4DeliverySettings(workspace.id);

    if (
      deliveryMode === "server" &&
      !apiSecret &&
      existingGa4Settings.credential?.tokenStatus !== "configured"
    ) {
      return Response.json(
        { ok: false, error: "GA4 API Secret is required for server-side delivery" },
        { status: 400 }
      );
    }

    await saveGa4DeliverySettings({
      workspaceId: workspace.id,
      propertyId,
      measurementId,
      deliveryMode,
      apiSecret: apiSecret || undefined,
    });

    return Response.json({
      ok: true,
      message: "GA4 delivery settings saved.",
    });
  }

  if (actionType === "save_google_conversions") {
    const googleAdsCustomerId = String(formData.get("googleAdsCustomerId") || "");
    const setupType = String(formData.get("setupType") || "default");
    const conversionName = String(formData.get("conversionName") || "");
    const conversionValueMode = String(formData.get("conversionValueMode") || "dynamic");
    const events = formData.getAll("events").map((event) => String(event));

    if (!googleAdsCustomerId) {
      return Response.json(
        { ok: false, error: "Google Ads account is required" },
        { status: 400 }
      );
    }

    if (!events.length) {
      return Response.json(
        { ok: false, error: "Select at least one conversion event" },
        { status: 400 }
      );
    }

    const savedConnections = await getWorkspaceConnections(workspace.id);
    const googleConnection = savedConnections.find(
      (item) => item.platform === "GOOGLE_ADS" && item.isActive
    );

    if (!googleConnection) {
      return Response.json(
        { ok: false, error: "Google account is not connected" },
        { status: 400 }
      );
    }

    const decryptedGoogleConnection = await getPlatformConnection(googleConnection.id);

    if (!decryptedGoogleConnection?.decryptedAccessToken) {
      return Response.json(
        { ok: false, error: "Google access token is missing" },
        { status: 400 }
      );
    }

    const createdActions = [];

    for (const eventName of events) {
      const action = await createOrReuseGoogleAdsConversionAction({
        accessToken: decryptedGoogleConnection.decryptedAccessToken,
        customerId: googleAdsCustomerId,
        eventName,
        baseName: conversionName,
        conversionValueMode,
      });

      await saveGoogleAdsConversionAction({
        workspaceId: workspace.id,
        googleAdsCustomerId,
        eventName,
        conversionName: action.name || eventName,
        conversionActionId: action.id ? String(action.id) : undefined,
        resourceName: action.resourceName,
        category: eventName,
        reused: Boolean(action.reused),
        deliveryMode,
      });

      createdActions.push(action);
    }

    await saveGoogleConversionConfig({
      workspaceId: workspace.id,
      googleAdsCustomerId,
      setupType,
      conversionName,
      conversionValueMode,
      events,
    });

    return Response.json({
      ok: true,
      message: `Saved and created/reused ${createdActions.length} Google Ads conversion action(s).`,
      createdActions,
    });
  }

  return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
}

const platformConfigs = [
  {
    key: "google",
    name: "Google",
    connectText: "Connect Google",
    oauthPath: "/api/oauth/google-init",
    description: "Select Google Analytics, Google Ads, and Merchant Center assets.",
    fields: ["GA4 Property", "Google Ads Account / Manager Account", "Google Merchant Center"],
  },
  {
    key: "meta",
    name: "Meta",
    connectText: "Connect Meta",
    oauthPath: "/api/oauth/meta-init",
    description: "Select Meta Business Manager, ad account, pixel, dataset, and catalog.",
    fields: ["Meta Business Manager", "Meta Ad Account", "Meta Pixel", "Meta Dataset", "Meta Catalog"],
  },
  {
    key: "tiktok",
    name: "TikTok",
    connectText: "Connect TikTok",
    oauthPath: "/api/oauth/tiktok-init",
    description: "Select TikTok ad account, pixel, Events API, and catalog.",
    fields: ["TikTok Ad Account", "TikTok Pixel", "TikTok Events API Destination", "TikTok Catalog"],
  },
  {
    key: "pinterest",
    name: "Pinterest",
    connectText: "Connect Pinterest",
    oauthPath: "/api/oauth/pinterest-init",
    description: "Select Pinterest ad account, tag, and catalog.",
    fields: ["Pinterest Ad Account", "Pinterest Tag", "Pinterest Catalog"],
  },
  {
    key: "microsoft",
    name: "Microsoft",
    connectText: "Connect Microsoft",
    oauthPath: "/api/oauth/microsoft-init",
    description: "Select Microsoft Ads account, UET tag, and Merchant Center.",
    fields: ["Microsoft Ads Account", "Microsoft UET Tag", "Microsoft Merchant Center"],
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    connectText: "Connect LinkedIn",
    oauthPath: "/api/oauth/linkedin-init",
    description: "Select LinkedIn ad account, insight tag, and conversion rule.",
    fields: ["LinkedIn Ad Account", "LinkedIn Insight Tag", "LinkedIn Conversion Rule"],
  },
];

export default function ConfigurationPage() {
  const { shop, connections, assets, savedAssetSelections, ga4DeliverySettings } = useLoaderData<typeof loader>();
  const [activeModal, setActiveModal] = useState<"ga4" | "conversions" | "feed" | null>(null);
  const conversionFetcher = useFetcher();
  const conversionResult = conversionFetcher.data as
    | { ok?: boolean; error?: string; message?: string }
    | undefined;
  const [selectedAssets, setSelectedAssets] =
    useState<Record<string, string>>(savedAssetSelections || {});
  const assetSelectionFetcher = useFetcher();
  const ga4DeliveryFetcher = useFetcher();
  const ga4DeliveryResult = ga4DeliveryFetcher.data as
    | { ok?: boolean; error?: string; message?: string }
    | undefined;
  const [ga4DeliveryMode, setGa4DeliveryMode] = useState(
    ga4DeliverySettings?.setting?.deliveryMode === "server" ? "server" : "client"
  );

  const ga4PropertyValue =
    selectedAssets["google:GA4 Property"] || "";
  const googleAdsAccountValue =
    selectedAssets["google:Google Ads Account / Manager Account"] || "";
  const merchantCenterValue =
    selectedAssets["google:Google Merchant Center"] || "";

  function fieldKey(platformKey: string, field: string) {
    return `${platformKey}:${field}`;
  }

  function getFieldOptions(platformKey: string, field: string): AssetOption[] {
    if (platformKey === "google" && field === "GA4 Property") {
      return assets.google.ga4Properties;
    }

    if (platformKey === "google" && field === "Google Ads Account / Manager Account") {
      return assets.google.googleAdsAccounts;
    }

    if (platformKey === "google" && field === "Google Merchant Center") {
      return assets.google.merchantCenters;
    }

    return [];
  }

  function getEmptyOptionText(platformKey: string, field: string) {
    if (platformKey === "google" && field === "GA4 Property") {
      return "No GA4 properties found or API access pending";
    }

    if (platformKey === "google" && field === "Google Ads Account / Manager Account") {
      return "Google Ads account API pending";
    }

    if (platformKey === "google" && field === "Google Merchant Center") {
      return "Merchant Center API pending";
    }

    return "Asset loading API pending";
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.kicker}>Conversion Tracking</p>
        <h1 style={styles.title}>Configuration</h1>
        <p style={styles.subtitle}>
          Select connected platform assets, configure conversions, and create catalog feeds.
        </p>
      </section>

      <section style={styles.notice}>
        Tracking IDs, conversion labels, pixels, catalogs, and feed settings will be selected from connected platform accounts.
        Manual ID entry is not required.
      </section>

      <section style={styles.statusBox}>
        <h2 style={styles.sectionTitle}>Web Pixel Status</h2>
        <div style={styles.statusGrid}>
          <div style={styles.statusRow}>
            <span>Shop</span>
            <strong>{shop}</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Pixel Status</span>
            <strong>Active / Connected</strong>
          </div>
        </div>

        <div style={styles.buttonRow}>
          <a href="/app/activate-pixel" style={styles.primaryButton}>
            Activate Pixel
          </a>
          <button type="button" style={styles.secondaryButton}>
            Deactivate Coming Soon
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Platform Asset Configuration</h2>
        <p style={styles.helpText}>
          GA4, Google Ads, Merchant Center, Meta Business Manager, ad accounts, pixels, datasets, and catalogs appear only after the platform is connected.
        </p>

        <div style={styles.grid}>
          {platformConfigs.map((platform) => {
            const connection = connections[platform.key as keyof typeof connections];
            const isConnected = connection?.connected;
            const oauthUrl = `${platform.oauthPath}?shop=${shop}`;

            return (
              <article
                key={platform.key}
                style={{
                  ...styles.card,
                  background: isConnected ? "#f0fdf4" : "#fff",
                  borderColor: isConnected ? "#86efac" : "#e5e7eb",
                }}
              >
                <div style={styles.cardHeader}>
                  <div>
                    <h3 style={styles.cardTitle}>{platform.name}</h3>
                    <span
                      style={{
                        ...styles.status,
                        background: isConnected ? "#dcfce7" : "#f3f4f6",
                        color: isConnected ? "#166534" : "#374151",
                        borderColor: isConnected ? "#86efac" : "#d1d5db",
                      }}
                    >
                      {isConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>

                  {isConnected ? (
                    <a href={oauthUrl} target="_blank" rel="noreferrer" style={styles.smallButton}>
                      Reconnect
                    </a>
                  ) : (
                    <a href={oauthUrl} target="_blank" rel="noreferrer" style={styles.smallButton}>
                      {platform.connectText}
                    </a>
                  )}
                </div>

                {isConnected && connection.accountName && (
                  <p style={styles.connectedText}>
                    Connected account: {connection.accountName}
                  </p>
                )}

                <p style={styles.description}>{platform.description}</p>

                {!isConnected && (
                  <div style={styles.lockedBox}>
                    Connect {platform.name} to select account assets.
                  </div>
                )}

                {isConnected && (
                  <>
                    <div style={styles.fieldStack}>
                      {platform.fields.map((field) => {
                        const key = fieldKey(platform.key, field);
                        const options = getFieldOptions(platform.key, field);

                        return (
                          <div key={field} style={styles.assetFieldBlock}>
                            <label style={styles.label}>
                              {field}
                              <select
                                value={selectedAssets[key] || ""}
                                onChange={(event) => {
                                  const selectedValue = event.target.value;
                                  const selectedLabel =
                                    event.currentTarget.options[event.currentTarget.selectedIndex]?.text || "";

                                  setSelectedAssets((previous) => ({
                                    ...previous,
                                    [key]: selectedValue,
                                  }));

                                  if (selectedValue) {
                                    assetSelectionFetcher.submit(
                                      {
                                        _action: "save_asset_selection",
                                        platform: platform.key,
                                        assetType: field,
                                        assetValue: selectedValue,
                                        assetLabel: selectedLabel,
                                      },
                                      { method: "post" }
                                    );

                                    if (platform.key === "google" && field === "GA4 Property") {
                                      setTimeout(() => window.location.reload(), 700);
                                    }
                                  }
                                }}
                                style={styles.select}
                              >
                                <option value="">
                                  {options.length ? `Select ${field}` : getEmptyOptionText(platform.key, field)}
                                </option>

                                {options.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {platform.key === "google" && field === "GA4 Property" && (
                              <button
                                type="button"
                                style={selectedAssets[key] ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!selectedAssets[key]}
                                onClick={() => setActiveModal("ga4")}
                              >
                                Configuration
                              </button>
                            )}

                            {platform.key === "google" && field === "Google Ads Account / Manager Account" && (
                              <button
                                type="button"
                                style={selectedAssets[key] ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!selectedAssets[key]}
                                onClick={() => setActiveModal("conversions")}
                              >
                                Conversions
                              </button>
                            )}

                            {platform.key === "google" && field === "Google Merchant Center" && (
                              <button
                                type="button"
                                style={selectedAssets[key] ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!selectedAssets[key]}
                                onClick={() => setActiveModal("feed")}
                              >
                                Create Feed
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section style={styles.statusBox}>
        <h2 style={styles.sectionTitle}>Event Delivery Status</h2>
        <div style={styles.statusGrid}>
          <div style={styles.statusRow}>
            <span>Pixel Installed</span>
            <strong>Connected</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Last Event Received</span>
            <strong>Pending live event</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Last Event Forwarded</span>
            <strong>Pending platform configuration</strong>
          </div>
        </div>
      </section>

      {activeModal === "ga4" && (
        <Modal title="GA4 Configuration" onClose={() => setActiveModal(null)}>
          <ga4DeliveryFetcher.Form method="post" style={styles.modalGrid}>
            <input type="hidden" name="_action" value="save_ga4_delivery_settings" />
            <input type="hidden" name="propertyId" value={ga4PropertyValue} />

            <label style={styles.label}>
              Selected GA4 Property
              <input
                style={styles.input}
                value={ga4PropertyValue || "Select GA4 Property first"}
                readOnly
              />
            </label>

            {assets.google.ga4DataStreams.length > 0 ? (
              <label style={styles.label}>
                GA4 Data Stream / Measurement ID
                <select
                  style={styles.select}
                  name="measurementId"
                  defaultValue={ga4DeliverySettings?.credential?.assetId || ""}
                >
                  <option value="">Select Measurement ID</option>
                  {assets.google.ga4DataStreams.map((stream) => (
                    <option key={stream.value} value={stream.value}>
                      {stream.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label style={styles.label}>
                GA4 Measurement ID
                <input
                  style={styles.input}
                  name="measurementId"
                  placeholder="Example: G-XXXXXXXXXX"
                  defaultValue={ga4DeliverySettings?.credential?.assetId || ""}
                />
              </label>
            )}

            <label style={styles.label}>
              Delivery Mode
              <select
                style={styles.select}
                name="deliveryMode"
                value={ga4DeliveryMode}
                onChange={(event) => setGa4DeliveryMode(event.target.value)}
              >
                <option value="client">Client-side only</option>
                <option value="server">Server-side only</option>
              </select>
            </label>

            {ga4DeliveryMode === "server" && (
              <label style={styles.label}>
                GA4 API Secret
                <input
                  style={styles.input}
                  name="apiSecret"
                  type="password"
                  placeholder={
                    ga4DeliverySettings?.credential?.tokenStatus === "configured"
                      ? "Already saved. Leave blank to keep existing secret."
                      : "Paste GA4 Measurement Protocol API Secret"
                  }
                />
              </label>
            )}

            {ga4DeliveryResult?.ok && (
              <div style={styles.successBox}>
                {ga4DeliveryResult.message || "GA4 settings saved."}
              </div>
            )}

            {ga4DeliveryResult?.error && (
              <div style={styles.errorBox}>
                {ga4DeliveryResult.error}
              </div>
            )}

            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button
                type="submit"
                style={ga4PropertyValue ? styles.primaryButton : styles.disabledButton}
                disabled={!ga4PropertyValue || ga4DeliveryFetcher.state !== "idle"}
              >
                {ga4DeliveryFetcher.state === "idle"
                  ? "Save GA4 Configuration"
                  : "Saving..."}
              </button>
            </div>
          </ga4DeliveryFetcher.Form>
        </Modal>
      )}

      {activeModal === "conversions" && (
        <Modal title="Google Ads Conversion Configuration" onClose={() => setActiveModal(null)}>
          <conversionFetcher.Form method="post" style={styles.modalGrid}>
            <input type="hidden" name="_action" value="save_google_conversions" />

            <label style={styles.label}>
              Selected Google Ads Account
              <input
                style={styles.input}
                name="googleAdsCustomerId"
                value={googleAdsAccountValue}
                readOnly
              />
            </label>

            <label style={styles.label}>
              Conversion Setup Type
              <select style={styles.select} name="setupType" defaultValue="default">
                <option value="default">Use default recommended conversions</option>
                <option value="custom">Create custom conversions</option>
                <option value="existing">Select existing conversions</option>
              </select>
            </label>

            <div style={styles.checkGrid}>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="PAGE_VIEW" defaultChecked />
                Page View
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="VIEW_ITEM" />
                View Item
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="ADD_TO_CART" />
                Add to Cart
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="BEGIN_CHECKOUT" />
                Begin Checkout
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="PURCHASE" defaultChecked />
                Purchase
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="LEAD" />
                Lead
              </label>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" name="events" value="SUBSCRIBE" />
                Subscribe
              </label>
            </div>

            <label style={styles.label}>
              Custom Conversion Name
              <input
                style={styles.input}
                name="conversionName"
                placeholder="Example: Shopify Purchase - Primary"
                defaultValue="Shopify Purchase - Primary"
              />
            </label>

            <label style={styles.label}>
              Conversion Value
              <select style={styles.select} name="conversionValueMode" defaultValue="dynamic">
                <option value="dynamic">Use dynamic Shopify value</option>
                <option value="fixed">Use fixed value</option>
                <option value="none">No value</option>
              </select>
            </label>

            <label style={styles.label}>
              Google Ads Delivery Mode
              <select style={styles.select} name="deliveryMode" defaultValue="client">
                <option value="client">Client-side only</option>
                <option value="server">Server-side only</option>
              </select>
            </label>

            {conversionResult?.ok && (
              <div style={styles.successBox}>
                {conversionResult.message || "Conversion configuration saved."}
              </div>
            )}

            {conversionResult?.error && (
              <div style={styles.errorBox}>
                {conversionResult.error}
              </div>
            )}

            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={conversionFetcher.state !== "idle"}
              >
                {conversionFetcher.state === "idle"
                  ? "Save Conversion Configuration"
                  : "Saving..."}
              </button>
            </div>
          </conversionFetcher.Form>
        </Modal>
      )}

      {activeModal === "feed" && (
        <Modal title="Merchant Center Feed Configuration" onClose={() => setActiveModal(null)}>
          <div style={styles.modalGrid}>
            <label style={styles.label}>
              Selected Merchant Center
              <input style={styles.input} value={merchantCenterValue} readOnly />
            </label>

            <label style={styles.label}>
              Target Country
              <select style={styles.select} defaultValue="US">
                <option value="US">United States - US</option>
                <option value="CA">Canada - CA</option>
                <option value="GB">United Kingdom - GB</option>
                <option value="AU">Australia - AU</option>
                <option value="BD">Bangladesh - BD</option>
              </select>
            </label>

            <label style={styles.label}>
              Product ID Format
              <select style={styles.select} defaultValue="country_product_variant">
                <option value="country_product">Shopify_country-code_productID</option>
                <option value="country_variant">Shopify_country-code_variantID</option>
                <option value="country_product_variant">Shopify_country-code_productID_variantID</option>
                <option value="product_variant">productID+variantID</option>
                <option value="variant">variantID only</option>
                <option value="product">productID only</option>
              </select>
            </label>

            <label style={styles.label}>
              Feed Creation Method
              <select style={styles.select} defaultValue="all">
                <option value="all">All active Shopify products</option>
                <option value="category">Create feed by category/collection</option>
                <option value="selected">Create feed from selected products</option>
              </select>
            </label>

            <label style={styles.label}>
              Category / Collection
              <select style={styles.select} defaultValue="">
                <option value="">Select category or collection</option>
                <option value="pending">Collection loading API pending</option>
              </select>
            </label>

            <label style={styles.label}>
              Specific Products
              <textarea
                style={styles.textarea}
                placeholder="Search/select products later. Product selector API pending."
              />
            </label>

            <div style={styles.checkGrid}>
              {["Sync title", "Sync description", "Sync images", "Sync variants", "Sync price", "Sync inventory", "Sync category"].map((item) => (
                <label key={item} style={styles.checkboxLabel}>
                  <input type="checkbox" defaultChecked />
                  {item}
                </label>
              ))}
            </div>

            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button type="button" style={styles.primaryButton}>
                Save Feed Configuration
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1280, margin: "0 auto" },
  hero: {
    padding: 24,
    borderRadius: 20,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    marginBottom: 20,
  },
  kicker: { margin: 0, color: "#2563eb", fontWeight: 800 },
  title: { margin: "8px 0", fontSize: "clamp(28px, 5vw, 44px)" },
  subtitle: { color: "#4b5563", lineHeight: 1.6, maxWidth: 780 },
  notice: {
    padding: 16,
    borderRadius: 14,
    background: "#ecfdf5",
    color: "#166534",
    border: "1px solid #86efac",
    fontWeight: 700,
    marginBottom: 24,
  },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 24, marginBottom: 8 },
  helpText: { color: "#4b5563", lineHeight: 1.6 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 16,
    marginTop: 16,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 18,
    boxShadow: "0 8px 24px rgba(15,23,42,.06)",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  cardTitle: { margin: "0 0 8px", fontSize: 18 },
  status: {
    display: "inline-block",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  connectedText: {
    margin: "12px 0 0",
    color: "#166534",
    fontSize: 13,
    fontWeight: 700,
  },
  description: { color: "#4b5563", lineHeight: 1.5 },
  lockedBox: {
    padding: 12,
    background: "#f9fafb",
    border: "1px dashed #d1d5db",
    borderRadius: 12,
    color: "#6b7280",
    fontWeight: 700,
  },
  fieldStack: {
    display: "grid",
    gap: 12,
    marginTop: 14,
  },
  label: {
    display: "grid",
    gap: 6,
    color: "#374151",
    fontWeight: 700,
    fontSize: 14,
  },
  select: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#111827",
  },
  input: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#111827",
  },
  textarea: {
    width: "100%",
    minHeight: 90,
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#111827",
  },
  smallButton: {
    background: "#2563eb",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
    textDecoration: "none",
    fontSize: 13,
  },
  primaryButton: {
    background: "#2563eb",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
    textDecoration: "none",
  },
  disabledButton: {
    background: "#9ca3af",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "not-allowed",
    fontWeight: 700,
    opacity: 0.7,
  },
  secondaryButton: {
    background: "#6b7280",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
  statusBox: {
    marginTop: 28,
    padding: 20,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 18,
  },
  statusGrid: { display: "grid", gap: 10, marginTop: 12 },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    background: "#fff",
    borderRadius: 12,
  },
  buttonRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 16,
  },
  assetFieldBlock: {
    display: "grid",
    gap: 8,
  },
  inlineActionButton: {
    width: "fit-content",
    background: "#2563eb",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  googleActions: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 16,
  },
  actionCard: {
    padding: 14,
    background: "#fff",
    border: "1px solid #bbf7d0",
    borderRadius: 14,
  },
  actionTitle: { margin: "0 0 8px", fontSize: 15 },
  actionText: { margin: "0 0 12px", color: "#4b5563", lineHeight: 1.5, fontSize: 13 },
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(15, 23, 42, .55)",
    zIndex: 9999,
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  modal: {
    width: "min(760px, 100%)",
    maxHeight: "90vh",
    overflow: "auto",
    background: "#fff",
    borderRadius: 18,
    padding: 22,
    boxShadow: "0 24px 80px rgba(0,0,0,.25)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    marginBottom: 18,
  },
  closeButton: {
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    width: 36,
    height: 36,
    cursor: "pointer",
    fontSize: 22,
    lineHeight: 1,
  },
  modalGrid: {
    display: "grid",
    gap: 14,
  },
  checkGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    padding: 12,
    background: "#f9fafb",
    borderRadius: 12,
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
    color: "#374151",
  },
  successBox: {
    padding: 12,
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
    borderRadius: 10,
    fontWeight: 700,
  },
  errorBox: {
    padding: 12,
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fca5a5",
    borderRadius: 10,
    fontWeight: 700,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
  },
};
