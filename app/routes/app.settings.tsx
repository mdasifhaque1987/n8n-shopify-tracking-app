import db from "../db.server";
import {
  resolveGoogleAccessToken,
  withGoogleAccessTokenRetry,
} from "../services/google-token.server";
import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  getGa4DeliverySettings,
  saveGa4DeliverySettings,
} from "../services/ga4-delivery-settings.server";
import { createOrReuseGoogleAdsConversionAction } from "../services/google-ads-conversion-action.server";
import { saveGoogleAdsConversionAction } from "../services/google-ads-conversion-action-map.server";
import { saveGoogleConversionConfig } from "../services/google-conversion-config.server";
import { createMerchantCenterFeed } from "../services/merchant-center-feed.server";
import {
  getAssetSelections,
  getAssetSelectionLabels,
  deleteAssetSelection,
  saveAssetSelection,
} from "../services/asset-selection.server";
import {
  getGoogleAssetDiscoveryCache,
  saveGoogleAssetDiscoveryCache,
} from "../services/google-asset-cache.server";
import { getOrCreateShopWorkspace } from "../services/workspace.server";
import { authenticate } from "../shopify.server";
import {
  getPlatformConnection,
  getWorkspaceConnections,
  getGooglePlatformConnection,
} from "../services/platform-connection.server";
import {
  getGoogleAnalyticsProperties,
  getGoogleAnalyticsDataStreams,
  getGoogleAdsAccounts,
  getMerchantCenters,
  GoogleAdsDiscoveryError,
} from "../services/oauth/google.server";
import {
  formatGa4PropertyLabel,
  Ga4DiscoveryError,
  reconcileGa4Selection,
} from "../services/ga4-property-discovery.server";
import {
  getGa4ApiSecretTitleColor,
  getGa4EmptyOptionText,
  getGa4PropertyDisplayOptions,
  isGa4ApiSecretConfigured,
} from "../services/ga4-settings-display";
import { getMetaBusinessPortfolios, getMetaDatasetsForBusiness } from "../services/oauth/meta.server";

import { getTestModeSettings, saveTestModeSettings } from "../services/test-mode.server";
import {
  getShopEntitlements,
  getShopSubscription,
  recordPlanRedirect,
  removeServerSideSettings,
} from "../services/subscription.server";
import { verifyShopifyAppPricingSubscription } from "../services/shopify-app-pricing.server";
import {
  deactivateEventIngestPixel,
  getEventIngestPixelStatus,
  synchronizeWebPixelSettings,
} from "../services/shopify-web-pixel.server";
import {
  decryptToken,
  encryptToken,
} from "../lib/encryption.server";
async function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 8000
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

type AssetOption = {
  value: string;
  label: string;
  loginCustomerId?: string;
  manager?: boolean;
  status?: string;
};

function readStoredMetaSecret(
  value: string | null | undefined
) {
  const stored =
    String(
      value || ""
    ).trim();

  if (
    !stored ||
    stored === "none"
  ) {
    return "";
  }

  try {
    if (
      stored.startsWith(
        "enc:v1:"
      )
    ) {
      return String(
        decryptToken(
          stored.slice(7)
        ) || ""
      ).trim();
    }

    /*
     * Backward compatibility for older
     * unencrypted values, if any exist.
     */
    return stored;
  } catch (error) {
    console.warn(
      "[Meta Settings] Stored secret could not be decrypted",
      {
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      }
    );

    return "";
  }
}


function maskMetaCapiToken(
  value: string | null | undefined
) {
  const token =
    String(
      value || ""
    ).trim();

  if (!token) {
    return "";
  }

  /*
   * Normal Meta access tokens are much longer
   * than twelve characters.
   *
   * Never reveal a short secret completely.
   */
  if (token.length <= 12) {
    const visible =
      Math.min(
        3,
        Math.max(
          1,
          Math.floor(
            token.length / 4
          )
        )
      );

    return (
      token.slice(
        0,
        visible
      ) +
      "************" +
      token.slice(
        -visible
      )
    );
  }

  return (
    token.slice(
      0,
      6
    ) +
    "************" +
    token.slice(
      -6
    )
  );
}


export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const savedConnections = await getWorkspaceConnections(workspace.id);
  const savedAssetSelections = await getAssetSelections(workspace.id);
  const savedAssetSelectionLabels = await getAssetSelectionLabels(workspace.id);
  const ga4DeliverySettings = await getGa4DeliverySettings(workspace.id);
  const testModeSettings = await getTestModeSettings(workspace.id);
  const webPixelStatus = await withTimeout(
    getEventIngestPixelStatus(
      session.shop,
      admin,
    ),
    {
      pixelExists: false,
      ingestKeyConfigured: false,
      storedPixelId: null,
      statusError:
        "Shopify web pixel status could not be verified.",
      lastSyncError: null,
    },
    8000,
  );
  const savedGa4PropertyId = savedAssetSelections["google:GA4 Property"] || "";
  let ga4AssetMessage = "";
  let googleAdsAssetMessage = "";
  const url = new URL(request.url);
  const redirectedPlanHandle =
    url.searchParams.get("plan_handle");

  let subscriptionVerification = null;

  if (redirectedPlanHandle) {
    await recordPlanRedirect({
      shop: session.shop,
      shopifyPlanHandle: redirectedPlanHandle,
    });

    subscriptionVerification =
      await verifyShopifyAppPricingSubscription({
        shop: session.shop,
        admin,
      });
  }

  const subscription =
    await getShopSubscription(session.shop);

  const navParams = new URLSearchParams();
  const host = url.searchParams.get("host");
  const embedded = url.searchParams.get("embedded");
  const locale = url.searchParams.get("locale");

  navParams.set("shop", session.shop);
  if (host) navParams.set("host", host);
  if (embedded) navParams.set("embedded", embedded);
  if (locale) navParams.set("locale", locale);
  const shouldLoadGoogleAssets =
    url.searchParams.get("loadGoogleAssets") === "true";

  const shouldLoadGa4Assets =
    url.searchParams.get("loadGa4Assets") === "true" ||
    shouldLoadGoogleAssets;

  const shouldLoadMetaAssets =
    url.searchParams.get("loadMetaAssets") === "true";
  const requestedUnlockPlatform =
    url.searchParams.get("unlockPlatform");
  const unlockPlatform =
    requestedUnlockPlatform === "google" ||
    requestedUnlockPlatform === "meta"
      ? requestedUnlockPlatform
      : null;

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
    meta: {
      businessPortfolios: AssetOption[];
      datasetsPixels: AssetOption[];
    };
  } = {
    google: {
      ga4Properties: [],
      ga4DataStreams: [],
      googleAdsAccounts: [],
      merchantCenters: [],
    },
    meta: {
      businessPortfolios: [],
      datasetsPixels: [],
    },
  };

  const googleConnection = savedConnections.find(
    (item) => item.platform === "GOOGLE_ADS" && item.isActive
  );


  /*
   * Load the last successful Google discovery first.
   *
   * Normal React Router loader requests intentionally do
   * not call the external Google APIs. They must therefore
   * start with this persisted list instead of [].
   */
  if (googleConnection) {
    const googleAssetCache =
      await getGoogleAssetDiscoveryCache(
        workspace.id,
        String(
          googleConnection.accountId || ""
        )
      );

    assets.google.ga4Properties =
      googleAssetCache.ga4Properties;

    assets.google.googleAdsAccounts =
      googleAssetCache.googleAdsAccounts;

    assets.google.merchantCenters =
      googleAssetCache.merchantCenters;
  }


  if (googleConnection) {
    const decryptedGoogleConnection = await getPlatformConnection(googleConnection.id);

    if (decryptedGoogleConnection?.decryptedAccessToken) {
      /*
       * Google Ads and Merchant Center discovery can be expensive.
       *
       * Never run it on ordinary loader revalidation, focus events,
       * fetcher POSTs, or routine settings-page navigation.
       *
       * It is performed only after an explicit Google connect /
       * reconnect / refresh flow that supplies loadGoogleAssets=true.
       */
      if (shouldLoadGoogleAssets) {
        /*
         * GOOGLE ADS
         *
         * Run independently from Merchant Center.
         * A 429 here must not prevent GMC or GA4 discovery.
         */
        try {
          const googleAdsAccounts =
            await withGoogleAccessTokenRetry(
              googleConnection,
              (accessToken) =>
                getGoogleAdsAccounts(
                  accessToken,
                  assets.google.googleAdsAccounts
                )
            );

          const discoveredGoogleAdsAccounts =
            googleAdsAccounts.map((account) => ({
              value:
                account.customerId,
              label:
                account.descriptiveName &&
                account.descriptiveName !==
                  `Google Ads Account ${account.customerId}`
                  ? `${account.descriptiveName} (${account.customerId})`
                  : `Google Ads Account ${account.customerId}`,
              loginCustomerId:
                account.loginCustomerId || "",
              manager:
                account.manager,
              status:
                account.status,
            }));

          if (
            discoveredGoogleAdsAccounts.length > 0
          ) {
            assets.google.googleAdsAccounts =
              discoveredGoogleAdsAccounts;

            await saveGoogleAssetDiscoveryCache({
              workspaceId:
                workspace.id,
              googleAccountId:
                String(
                  googleConnection.accountId || ""
                ),
              kind:
                "googleAdsAccounts",
              options:
                discoveredGoogleAdsAccounts,
            });
          }

          if (
            googleAdsAccounts.length === 0 &&
            assets.google.googleAdsAccounts.length === 0
          ) {
            googleAdsAssetMessage =
              "No Google Ads accounts are directly accessible to this Google login.";
          }
        } catch (error) {
          const status =
            error instanceof GoogleAdsDiscoveryError
              ? error.status
              : 0;

          console.warn(
            "[Google Ads Discovery] Failed",
            {
              status,
              category:
                error instanceof GoogleAdsDiscoveryError
                  ? error.category
                  : "api_error",
            }
          );

          /*
           * Do not clear assets here.
           * The cached account list remains available.
           */
          googleAdsAssetMessage =
            error instanceof GoogleAdsDiscoveryError
              ? error.message
              : "Google Ads accounts could not be refreshed. The previous account list has been preserved.";
        }

        /*
         * MERCHANT CENTER
         *
         * This runs even if Google Ads discovery failed.
         */
        try {
          const merchantCenters =
            await withTimeout(
              withGoogleAccessTokenRetry(
                googleConnection,
                (accessToken) =>
                  getMerchantCenters(
                    accessToken,
                    assets.google.merchantCenters
                  )
              ),
              [],
              45000
            );

          /*
           * Preserve previously learned real Merchant Center
           * names if a later API refresh can only return IDs.
           */
          const cachedMerchantLabels =
            new Map(
              assets.google.merchantCenters.map(
                (option) => [
                  String(option.value || ""),
                  String(option.label || ""),
                ]
              )
            );

          const discoveredMerchantCenters =
            merchantCenters.map((account) => {
              const merchantId =
                String(
                  account.merchantId || ""
                ).trim();

              const discoveredName =
                String(
                  account.name || ""
                ).trim();

              const genericName =
                `Merchant Center ${merchantId}`;

              const genericLabel =
                `${genericName} (${merchantId})`;

              const cachedLabel =
                String(
                  cachedMerchantLabels.get(
                    merchantId
                  ) || ""
                ).trim();

              const hasRealDiscoveredName =
                Boolean(
                  discoveredName &&
                  discoveredName !==
                    genericName
                );

              const hasRealCachedName =
                Boolean(
                  cachedLabel &&
                  cachedLabel !==
                    genericName &&
                  cachedLabel !==
                    genericLabel
                );

              return {
                value:
                  merchantId,

                label:
                  hasRealDiscoveredName
                    ? `${discoveredName} (${merchantId})`
                    : hasRealCachedName
                      ? cachedLabel
                      : genericLabel,
              };
            });

          if (
            discoveredMerchantCenters.length > 0
          ) {
            assets.google.merchantCenters =
              discoveredMerchantCenters;

            await saveGoogleAssetDiscoveryCache({
              workspaceId:
                workspace.id,
              googleAccountId:
                String(
                  googleConnection.accountId || ""
                ),
              kind:
                "merchantCenters",
              options:
                discoveredMerchantCenters,
            });
          }
        } catch (error) {
          console.warn(
            "[Merchant Center Discovery] Failed",
            {
              errorName:
                error instanceof Error
                  ? error.name
                  : "UnknownError",
            }
          );

          /*
           * Previous Merchant Center cache is preserved.
           */
        }
      }

      if (shouldLoadGa4Assets) {
        try {
          const ga4Properties = await withGoogleAccessTokenRetry(
            googleConnection,
            (accessToken) =>
              getGoogleAnalyticsProperties(accessToken)
          );

          const discoveredGa4Properties =
            ga4Properties.map((property) => ({
              value:
                property.propertyId,
              label:
                formatGa4PropertyLabel(property),
            }));

          if (
            discoveredGa4Properties.length > 0
          ) {
            assets.google.ga4Properties =
              discoveredGa4Properties;

            await saveGoogleAssetDiscoveryCache({
              workspaceId:
                workspace.id,
              googleAccountId:
                String(
                  googleConnection.accountId || ""
                ),
              kind:
                "ga4Properties",
              options:
                discoveredGa4Properties,
            });
          }

          const selection = reconcileGa4Selection(
            savedGa4PropertyId,
            ga4Properties
          );

          if (selection.stale) {
            /*
             * Do not automatically delete the persisted GA4 property.
             *
             * A temporary API issue, permission transition, pagination
             * problem, or reconnect state must not silently destroy the
             * merchant's previously selected tracking destination.
             */
            ga4AssetMessage =
              "The previously selected GA4 property was not returned by the latest discovery. The saved selection has been preserved.";
          } else if (ga4Properties.length === 0) {
            ga4AssetMessage =
              "No GA4 properties are accessible to this Google account.";
          }

          if (selection.selectedPropertyId) {
            const ga4DataStreams = await withTimeout(
              withGoogleAccessTokenRetry(
                googleConnection,
                (accessToken) =>
                  getGoogleAnalyticsDataStreams(
                    accessToken,
                    selection.selectedPropertyId
                  )
              ),
              [],
              8000
            );

            assets.google.ga4DataStreams = ga4DataStreams.map((stream) => ({
              value: stream.measurementId,
              label: `${stream.displayName || "GA4 Data Stream"} (${stream.measurementId})`,
            }));
          }
        } catch (error) {
          const status = error instanceof Ga4DiscoveryError ? error.status : 0;
          const category =
            error instanceof Ga4DiscoveryError ? error.category : "api_error";
          console.warn("[GA4 Discovery] Failed", { status, category });
          ga4AssetMessage =
            error instanceof Ga4DiscoveryError
              ? error.message
              : "Google Analytics properties could not be loaded. Try reconnecting Google.";
        }
      }
    }
  }

  const metaConnection = savedConnections.find(
    (item) => item.platform === "META" && item.isActive
  );

  if (metaConnection) {
    const decryptedMetaConnection = await getPlatformConnection(metaConnection.id);

    if (decryptedMetaConnection?.decryptedAccessToken) {
      const businessPortfolios = await withTimeout(
        getMetaBusinessPortfolios(decryptedMetaConnection.decryptedAccessToken),
        [],
        12000
      );

      assets.meta.businessPortfolios = businessPortfolios.map((business) => ({
        value: business.businessId,
        label: `${business.name} (${business.businessId})`,
      }));

      const savedMetaBusinessId = String(
        savedAssetSelections["meta:Meta Business Portfolio"] || ""
      ).trim();

      if (savedMetaBusinessId) {
        const datasetsPixels = await withTimeout(
          getMetaDatasetsForBusiness(
            decryptedMetaConnection.decryptedAccessToken,
            savedMetaBusinessId
          ),
          [],
          12000
        );

        assets.meta.datasetsPixels = datasetsPixels.map((dataset) => ({
          value: dataset.datasetId,
          label: `${dataset.name} (${dataset.datasetId})`,
        }));
      }
    }
  }

  const savedGoogleAdsCustomerId = String(
    savedAssetSelections["google:Google Ads Account / Manager Account"] ||
      savedAssetSelections["GOOGLE_ADS:Google Ads Account / Manager Account"] ||
      ""
  )
    .replace(/-/g, "")
    .trim();

  const googleAdsConversionActions = savedGoogleAdsCustomerId
    ? await db.googleAdsConversionAction.findMany({
        where: {
          workspaceId: workspace.id,
          googleAdsCustomerId: savedGoogleAdsCustomerId,
          isActive: true,
        },
        select: {
id: true,
          eventName: true,
          conversionName: true,
          conversionId: true,
          conversionLabel: true,
          conversionActionId: true,
          deliveryMode: true,
          isPrimary: true,
          isActive: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      })
    : [];

  console.info(
    "[Configuration Loader] Google asset counts",
    {
      googleAdsAccounts:
        assets.google.googleAdsAccounts.length,
      ga4Properties:
        assets.google.ga4Properties.length,
      merchantCenters:
        assets.google.merchantCenters.length,
      savedGoogleAdsAccount:
        savedAssetSelections[
          "google:Google Ads Account / Manager Account"
        ] || null,
    }
  );

  const savedMetaTestEventCode =
    readStoredMetaSecret(
      savedAssetSelections[
        "meta:Meta Test Event Code"
      ]
    );

  const savedMetaCapiAccessToken =
    readStoredMetaSecret(
      savedAssetSelections[
        "meta:Meta CAPI Access Token"
      ]
    );

  /*
   * The full CAPI token never leaves the server.
   */
  const savedMetaCapiAccessTokenPreview =
    maskMetaCapiToken(
      savedMetaCapiAccessToken
    );

  return {
    shop: session.shop,
    navQuery: navParams.toString(),
    subscription,
    subscriptionVerification,
    redirectedPlanHandle,
    shouldLoadGoogleAssets,
    shouldLoadGa4Assets,
    shouldLoadMetaAssets,
    unlockPlatform,
    connections: {
      google: getStatus("GOOGLE_ADS"),
      meta: getStatus("META"),
      tiktok: getStatus("TIKTOK"),
      pinterest: getStatus("PINTEREST"),
      microsoft: getStatus("MICROSOFT_ADS"),
      linkedin: getStatus("LINKEDIN"),
    },
    assets,
    ga4AssetMessage,
    googleAdsAssetMessage,
    savedAssetSelections: {
      ...savedAssetSelections,

      /*
       * Test Event Code is editable and may be shown
       * to the authenticated merchant.
       */
      ["meta:Meta Test Event Code"]:
        savedMetaTestEventCode ||
        "none",

      /*
       * Never send the complete CAPI token to the browser.
       */
      ["meta:Meta CAPI Access Token"]:
        savedMetaCapiAccessTokenPreview,
    } as Record<string, string>,
    savedAssetSelectionLabels,
    ga4DeliverySettings,
    testModeSettings,
    webPixelStatus,
    googleAdsConversionActions,
  };
}


export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const workspace = await getOrCreateShopWorkspace(session.shop);
  const entitlements = await getShopEntitlements(session.shop);

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");
  const entitlementError =
    "Your Core Starter plan includes client-side tracking only. Upgrade to Core Server to enable GA4 server-side, Google Ads server-side, or Meta CAPI delivery.";
  const synchronizePixel = async () => {
    try {
      await synchronizeWebPixelSettings({ shop: session.shop, admin });
      return null;
    } catch (error) {
      return Response.json({
        ok: false,
        saved: true,
        syncFailed: true,
        retryAvailable: true,
        warning: "Configuration was saved, but Shopify web pixel synchronization failed. Activate or refresh the web pixel before testing the storefront.",
        error:
          error instanceof Error
            ? error.message
            : "Web pixel synchronization failed.",
      }, { status: 200 });
    }
  };

  if (actionType === "deactivate_web_pixel") {
    try {
      const result = await deactivateEventIngestPixel({
        shop: session.shop,
        admin,
      });

      return Response.json({
        ok: true,
        pixelDeactivated: true,
        message: result.deleted
          ? "Web pixel deactivated successfully."
          : "The web pixel was already inactive.",
      });
    } catch (error) {
      return Response.json({
        ok: false,
        pixelDeactivated: false,
        error:
          error instanceof Error
            ? error.message
            : "Web pixel deactivation failed.",
      });
    }
  }

  const requestedServerSide =
    (actionType === "save_asset_selection" &&
      String(formData.get("assetType") || "").endsWith(":server_side") &&
      String(formData.get("assetValue") || "") === "true") ||
    (actionType === "save_meta_dataset_settings" &&
      String(formData.get("serverSideEnabled") || "") === "true") ||
    (actionType === "save_ga4_delivery_settings" &&
      String(formData.get("deliveryMode") || "") === "server") ||
    (actionType === "save_google_conversions" &&
      String(formData.get("deliveryMode") || "") === "server");

  if (!entitlements.googleAdsServerSide) {
    await removeServerSideSettings(session.shop);

    if (requestedServerSide) {
      return Response.json({ ok: false, error: entitlementError }, { status: 403 });
    }
  }

  if (actionType === "save_test_mode") {
    const enabled = String(formData.get("enabled") || "") === "true";
    const selectedChannels = formData.getAll("selectedChannels").map(String);
    const overrides = Object.fromEntries(
      ["ga4_client", "ga4_server", "google_ads_client", "google_ads_server", "meta_pixel", "meta_capi"]
        .map((channel) => [channel, String(formData.get(`override:${channel}`) || "GLOBAL")]),
    );

    await saveTestModeSettings({
      workspaceId: workspace.id,
      enabled,
      selectedChannels,
      overrides,
    });

    const syncFailure = await synchronizePixel();
    if (syncFailure) return syncFailure;

    return Response.json({
      ok: true,
      testModeEnabled: enabled,
      message: enabled
        ? "Test Mode enabled. Events will be validated/logged before live sending."
        : "Live Mode enabled. Events can be sent to selected platforms.",
    });
  }


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

    /*
     * GA4, Google Ads, and Merchant Center become active
     * automatically when an asset is selected.
     *
     * Keep the legacy :enabled setting synchronized for
     * compatibility with any older configuration readers.
     */
    if (
      platform === "google" &&
      [
        "GA4 Property",
        "Google Ads Account / Manager Account",
        "Google Merchant Center",
      ].includes(assetType)
    ) {
      await saveAssetSelection({
        workspaceId: workspace.id,
        platform: "google",
        assetType: `${assetType}:enabled`,
        assetValue: "true",
        assetLabel: "Enabled by asset selection",
      });
    }

    if (
      platform === "google" &&
      assetType ===
        "Google Ads Account / Manager Account"
    ) {
      const loginCustomerId =
        String(
          formData.get(
            "loginCustomerId"
          ) || ""
        )
          .replace(/-/g, "")
          .trim();

      await saveAssetSelection({
        workspaceId: workspace.id,
        platform: "google",
        assetType:
          "Google Ads Login Customer ID",
        assetValue:
          loginCustomerId || "none",
        assetLabel:
          loginCustomerId
            ? `Manager ${loginCustomerId}`
            : "Direct account access",
      });
    }

    const syncFailure = await synchronizePixel();
    if (syncFailure) return syncFailure;

    return Response.json({
      ok: true,
      message: "Asset selection saved.",
    });
  }

  if (actionType === "save_meta_dataset_settings") {
    const datasetId =
      String(
        formData.get(
          "datasetId"
        ) || ""
      ).trim();

    const datasetName =
      String(
        formData.get(
          "datasetName"
        ) || ""
      ).trim();

    const selectedEvents =
      String(
        formData.get(
          "selectedEvents"
        ) || "none"
      ).trim() ||
      "none";

    const clientSideEnabled =
      String(
        formData.get(
          "clientSideEnabled"
        ) || "false"
      ) === "true";

    const requestedServerSideEnabled =
      String(
        formData.get(
          "serverSideEnabled"
        ) || "false"
      ) === "true";

    const testEventCode =
      String(
        formData.get(
          "testEventCode"
        ) || ""
      ).trim();

    const contentIdFormat =
      String(
        formData.get(
          "contentIdFormat"
        ) ||
        "shopify_country_product_variant"
      ).trim();

    const capiAccessToken =
      String(
        formData.get(
          "capiAccessToken"
        ) || ""
      ).trim();

    const requestedCapiTokenMode =
      String(
        formData.get(
          "capiAccessTokenMode"
        ) || ""
      ).trim();

    if (!datasetId) {
      return Response.json(
        {
          ok: false,
          error:
            "Please select a Meta Dataset / Pixel first.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Read the existing token only on the server.
     *
     * This allows us to distinguish:
     * - unchanged masked preview
     * - replacement token
     * - removal
     */
    const existingMetaSelections =
      await getAssetSelections(
        workspace.id
      );

    const existingCapiToken =
      readStoredMetaSecret(
        existingMetaSelections[
          "meta:Meta CAPI Access Token"
        ]
      );

    const existingCapiTokenPreview =
      maskMetaCapiToken(
        existingCapiToken
      );

    let capiTokenMode:
      | "keep"
      | "replace"
      | "remove";

    if (
      requestedCapiTokenMode ===
        "keep" &&
      existingCapiToken
    ) {
      capiTokenMode =
        "keep";
    } else if (
      requestedCapiTokenMode ===
        "remove" ||
      !capiAccessToken
    ) {
      capiTokenMode =
        "remove";
    } else if (
      existingCapiToken &&
      capiAccessToken ===
        existingCapiTokenPreview
    ) {
      /*
       * Additional protection if an older browser
       * does not send capiAccessTokenMode.
       */
      capiTokenMode =
        "keep";
    } else {
      capiTokenMode =
        "replace";
    }

    const hasCapiTokenAfterSave =
      capiTokenMode === "keep"
        ? Boolean(
            existingCapiToken
          )
        : capiTokenMode ===
            "replace"
          ? Boolean(
              capiAccessToken
            )
          : false;

    /*
     * Removing the CAPI token automatically disables
     * server-side Meta delivery.
     */
    const serverSideEnabled =
      requestedServerSideEnabled &&
      hasCapiTokenAfterSave;

    await saveAssetSelection({
      workspaceId:
        workspace.id,
      platform:
        "meta",
      assetType:
        "Meta Dataset / Pixel",
      assetValue:
        datasetId,
      assetLabel:
        datasetName ||
        datasetId,
    });

    await saveAssetSelection({
      workspaceId:
        workspace.id,
      platform:
        "meta",
      assetType:
        "Meta Selected Events",
      assetValue:
        selectedEvents,
      assetLabel:
        selectedEvents === "none"
          ? "No events selected"
          : selectedEvents,
    });

    await saveAssetSelection({
      workspaceId:
        workspace.id,
      platform:
        "meta",
      assetType:
        "Meta Client Side Enabled",
      assetValue:
        clientSideEnabled
          ? "true"
          : "false",
      assetLabel:
        clientSideEnabled
          ? "Enabled"
          : "Disabled",
    });

    await saveAssetSelection({
      workspaceId:
        workspace.id,
      platform:
        "meta",
      assetType:
        "Meta Server Side Enabled",
      assetValue:
        serverSideEnabled
          ? "true"
          : "false",
      assetLabel:
        serverSideEnabled
          ? "Enabled"
          : "Disabled",
    });

    /*
     * TEST EVENT CODE
     *
     * Blank means remove.
     */
    if (
      testEventCode &&
      testEventCode !==
        "__configured__" &&
      testEventCode !==
        "__saved__"
    ) {
      await saveAssetSelection({
        workspaceId:
          workspace.id,
        platform:
          "meta",
        assetType:
          "Meta Test Event Code",
        assetValue:
          `enc:v1:${encryptToken(
            testEventCode
          )}`,
        assetLabel:
          "Test event code configured",
      });
    } else if (
      !testEventCode
    ) {
      await deleteAssetSelection({
        workspaceId:
          workspace.id,
        platform:
          "meta",
        assetType:
          "Meta Test Event Code",
      });
    }

    await saveAssetSelection({
      workspaceId:
        workspace.id,
      platform:
        "meta",
      assetType:
        "Meta Content ID Format",
      assetValue:
        contentIdFormat,
      assetLabel:
        contentIdFormat,
    });

    /*
     * CAPI ACCESS TOKEN
     */
    if (
      capiTokenMode ===
        "replace"
    ) {
      const preview =
        maskMetaCapiToken(
          capiAccessToken
        );

      await saveAssetSelection({
        workspaceId:
          workspace.id,
        platform:
          "meta",
        assetType:
          "Meta CAPI Access Token",
        assetValue:
          `enc:v1:${encryptToken(
            capiAccessToken
          )}`,
        assetLabel:
          preview
            ? `Saved token ${preview}`
            : "Access token configured",
      });
    } else if (
      capiTokenMode ===
        "remove"
    ) {
      await deleteAssetSelection({
        workspaceId:
          workspace.id,
        platform:
          "meta",
        assetType:
          "Meta CAPI Access Token",
      });
    }

    const syncFailure =
      await synchronizePixel();

    if (syncFailure) {
      return syncFailure;
    }

    return Response.json({
      ok: true,

      message:
        "Meta Dataset / Pixel settings saved.",

      serverSideEnabled,

      capiTokenConfigured:
        hasCapiTokenAfterSave,
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
    const existingSecretConfiguredForMeasurement =
      existingGa4Settings.credential?.assetId === measurementId &&
      existingGa4Settings.credential.tokenStatus === "configured";

    if (
      deliveryMode === "server" &&
      !apiSecret &&
      !existingSecretConfiguredForMeasurement
    ) {
      return Response.json(
        { ok: false, error: "GA4 API Secret is required for server-side delivery" },
        { status: 400 }
      );
    }

    const savedGa4Settings = await saveGa4DeliverySettings({
      workspaceId: workspace.id,
      propertyId,
      measurementId,
      deliveryMode,
      apiSecret: apiSecret || undefined,
    });

    const syncFailure = await synchronizePixel();
    if (syncFailure) return syncFailure;

    return Response.json({
      ok: true,
      message: "GA4 delivery settings saved.",
      apiSecretConfigured:
        savedGa4Settings.credential.tokenStatus === "configured",
    });
  }

  if (actionType === "save_google_conversions") {
    const googleAdsCustomerId =
      String(
        formData.get(
          "googleAdsCustomerId"
        ) || ""
      )
        .replace(/-/g, "")
        .trim();

    const googleAdsLoginCustomerId =
      String(
        formData.get(
          "googleAdsLoginCustomerId"
        ) || ""
      )
        .replace(/-/g, "")
        .trim();

    const setupType =
      String(
        formData.get("setupType") ||
        "default"
      );
    const conversionName = String(formData.get("conversionName") || "").trim();
    const conversionActionRecordId = String(formData.get("conversionActionRecordId") || "").trim();
    const isPrimary = String(formData.get("isPrimary") || "true") === "true";
    const conversionValueMode = String(formData.get("conversionValueMode") || "dynamic");
    const rawDeliveryMode = String(formData.get("deliveryMode") || "client");
    const deliveryMode = rawDeliveryMode === "server" ? "server" : "client";
    const singleEventName = String(formData.get("eventName") || "").trim();
    const events = singleEventName
      ? [singleEventName]
      : formData.getAll("events").map((event: unknown) => String(event));

    if (!googleAdsCustomerId) {
      return Response.json(
        { ok: false, error: "Please select a Google Ads account first." },
        { status: 400 }
      );
    }

    if (!events.length) {
      return Response.json(
        { ok: false, error: "Please select a conversion event." },
        { status: 400 }
      );
    }

    if (
      deliveryMode === "server" &&
      events.some(
        (eventName) =>
          String(eventName).toUpperCase() !==
          "PURCHASE"
      )
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "Server-side Google Ads delivery currently supports Purchase only. Use client-side delivery for other conversion events.",
        },
        { status: 400 }
      );
    }

    const googleConnection = await getGooglePlatformConnection(workspace.id);

    if (!googleConnection) {
      return Response.json(
        { ok: false, error: "Google is not connected." },
        { status: 400 }
      );
    }

    let googleAccessToken = "";

    try {
      googleAccessToken = await resolveGoogleAccessToken(googleConnection);
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "Google access token could not be decrypted/refreshed. Please reconnect Google if needed.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 }
      );
    }

    const createdActions = [];

    for (const eventName of events) {
      try {
        const action = await createOrReuseGoogleAdsConversionAction({
          accessToken: googleAccessToken,
          customerId:
            googleAdsCustomerId,
          loginCustomerId:
            googleAdsLoginCustomerId ||
            undefined,
          eventName,
          baseName:
            conversionName,
          conversionValueMode,
          isPrimary,
        });

        await saveGoogleAdsConversionAction({
          workspaceId: workspace.id,
          googleAdsCustomerId,
          eventName,
          conversionName: action.name || eventName,
          conversionActionId: action.id ? String(action.id) : undefined,
          conversionId: action.conversionId,
          conversionLabel: action.conversionLabel,
          resourceName: action.resourceName,
          category: eventName,
          reused: Boolean(action.reused),
          deliveryMode,
          isPrimary,
          existingRecordId: conversionActionRecordId || undefined,
        });

        createdActions.push(action);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return Response.json(
          {
            ok: false,
            error:
              "Google Ads automatic conversion creation failed. Please check Google Ads account access, manager account login-customer-id, developer token access, and OAuth permissions.",
            details: message,
          },
          { status: 400 }
        );
      }
    }

    await saveGoogleConversionConfig({
      workspaceId: workspace.id,
      googleAdsCustomerId,
      setupType,
      conversionName,
      conversionValueMode,
      events,
    });

    const syncFailure = await synchronizePixel();
    if (syncFailure) return syncFailure;

    return Response.json({
      ok: true,
      message: conversionActionRecordId
        ? "Google Ads conversion action updated."
        : "Google Ads conversion action created and saved.",
      actions: createdActions,
    });
  }


  if (actionType === "delete_google_conversion") {
    const conversionActionRecordId = String(formData.get("conversionActionRecordId") || "");

    if (!conversionActionRecordId) {
      return Response.json(
        { ok: false, error: "Missing conversion action record ID." },
        { status: 400 }
      );
    }

    const conversionAction = await db.googleAdsConversionAction.findFirst({
      where: {
        id: conversionActionRecordId,
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        eventName: true,
        googleAdsCustomerId: true,
      },
    });

    if (!conversionAction) {
      return Response.json(
        { ok: false, error: "Conversion action not found." },
        { status: 404 }
      );
    }

    await db.googleAdsConversionAction.update({
      where: {
        id: conversionAction.id,
      },
      data: {
        isActive: false,
      },
    });

    const remainingActiveMappings =
      await db.googleAdsConversionAction.count({
        where: {
          workspaceId: workspace.id,
          googleAdsCustomerId:
            conversionAction.googleAdsCustomerId,
          eventName:
            conversionAction.eventName,
          isActive: true,
        },
      });

    /*
     * Only remove the event from the legacy aggregate config
     * when no other active conversion mapping still uses it.
     */
    if (remainingActiveMappings === 0) {
      const configs =
        await db.googleConversionConfig.findMany({
          where: {
            workspaceId: workspace.id,
            googleAdsCustomerId:
              conversionAction.googleAdsCustomerId,
            isActive: true,
          },
          select: {
            id: true,
            events: true,
          },
        });

      for (const config of configs) {
        if (
          config.events.includes(
            conversionAction.eventName
          )
        ) {
          await db.googleConversionConfig.update({
            where: {
              id: config.id,
            },
            data: {
              events: config.events.filter(
                (
                  event:
                    (typeof config.events)[number]
                ) =>
                  event !==
                  conversionAction.eventName
              ),
            },
          });
        }
      }
    }

    const syncFailure = await synchronizePixel();
    if (syncFailure) return syncFailure;

    return Response.json({
      ok: true,
      message: `${conversionAction.eventName} conversion removed from app tracking.`,
      deletedEventName: conversionAction.eventName,
    });
  }

  if (actionType === "create_merchant_feed") {
    const merchantId = String(formData.get("merchantId") || "").replace(/-/g, "").trim();
    const selectedTargetCountry = String(formData.get("targetCountry") || "US").trim() || "US";
    const customTargetCountry = String(formData.get("customTargetCountry") || "").trim().toUpperCase();
    if (
      selectedTargetCountry === "CUSTOM" &&
      !/^[A-Z]{2}$/.test(customTargetCountry)
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "Please enter a valid two-letter custom target country code.",
        },
        { status: 400 }
      );
    }

    const targetCountry =
      selectedTargetCountry === "CUSTOM"
        ? customTargetCountry
        : selectedTargetCountry.toUpperCase();

    if (!/^[A-Z]{2}$/.test(targetCountry)) {
      return Response.json(
        {
          ok: false,
          error: "Invalid target country code.",
        },
        { status: 400 }
      );
    }

    const contentLanguage = String(formData.get("contentLanguage") || "en").trim() || "en";
    const productIdFormat = String(formData.get("productIdFormat") || "shopify_country_product_variant").trim();
    const channel = String(formData.get("channel") || "online").trim();
    const marketingMethod = String(formData.get("marketingMethod") || "all").trim();
    const includeRestrictedProducts = String(formData.get("includeRestrictedProducts") || "") === "true";
    const scheduleInterval = String(formData.get("scheduleInterval") || "manual").trim();
    const limit = Number(formData.get("limit") || 10);

    if (!merchantId) {
      return Response.json(
        { ok: false, error: "Please select a Google Merchant Center account first." },
        { status: 400 }
      );
    }

    const googleConnection = await getGooglePlatformConnection(workspace.id);

    if (!googleConnection) {
      return Response.json(
        { ok: false, error: "Google is not connected." },
        { status: 400 }
      );
    }

    let googleAccessToken = "";

    try {
      googleAccessToken = await resolveGoogleAccessToken(googleConnection);
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "Google access token could not be decrypted/refreshed. Please reconnect Google if needed.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 }
      );
    }

    try {
      const result = await createMerchantCenterFeed({
        admin,
        accessToken: googleAccessToken,
        merchantId,
        shop: session.shop,
        limit,
        targetCountry,
        contentLanguage,
        productIdFormat,
        channel: channel === "local" ? "local" : "online",
        marketingMethod:
          marketingMethod === "free_listings" || marketingMethod === "shopping_ads"
            ? marketingMethod
            : "all",
        includeRestrictedProducts,
        scheduleInterval,
      });

      return Response.json({
        ok: true,
        message: `Merchant Center feed completed. Uploaded/updated: ${result.uploaded}, Skipped unchanged: ${result.skippedUnchanged || 0}, Failed: ${result.failed}, Skipped out of stock: ${result.skippedOutOfStock || 0}, Skipped restricted: ${result.skippedRestricted || 0}. Format: ${result.productIdFormat}. Sample ID: ${result.sampleOfferIds?.[0] || "n/a"}. Schedule: ${result.scheduleInterval || "manual"}.`,
        result,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "Merchant Center feed upload failed.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 }
      );
    }
  }


  return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
}

const metaEventOptions = [
  { value: "PageView", label: "PageView" },
  { value: "ViewContent", label: "ViewContent" },
  {
    value: "ViewContentList",
    label: "ViewContentList - custom event",
  },
  { value: "Search", label: "Search" },
  { value: "AddToCart", label: "AddToCart" },
  {
    value: "RemoveFromCart",
    label: "RemoveFromCart - custom event",
  },
  { value: "InitiateCheckout", label: "InitiateCheckout" },
  { value: "AddPaymentInfo", label: "AddPaymentInfo" },
  { value: "AddShippingInfo", label: "AddShippingInfo - custom event" },
  { value: "Purchase", label: "Purchase" },
  { value: "Lead", label: "Lead" },
  { value: "CompleteRegistration", label: "CompleteRegistration" },
  { value: "Contact", label: "Contact" },
  { value: "Subscribe", label: "Subscribe" },
];

const platformConfigs = [
  {
    key: "google",
    name: "Google",
    connectText: "Connect Google",
    oauthPath: "/api/oauth/google-init",
    description: "Select Google Analytics, Google Ads, and Merchant Center assets.",
    fields: ["GA4 Property", "Google Ads Account / Manager Account", "Google Merchant Center", "Google Ads Remarketing"],
  },
  {
    key: "meta",
    name: "Meta",
    connectText: "Connect Meta",
    oauthPath: "/api/oauth/meta-init",
    description: "Connect Meta and allow Business Portfolio access. To show all portfolios, choose all current and future Businesses in the Meta permission screen. Then select the Business Portfolio inside this app.",
    fields: ["Meta Business Portfolio", "Meta Dataset / Pixel"],
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


const FIELD_HELP: Record<string, string> = {
  "GA4 Property":
    "Select the GA4 property for this Shopify store. After selection it is locked to help prevent events being sent to the wrong property. Reconnect Google when you intentionally need to change it.",

  "Google Ads Account / Manager Account":
    "Select the Google Ads customer account that should receive conversions. Conversion actions normally belong to the advertising client account. Manager accounts can provide access to client accounts.",

  "Google Merchant Center":
    "Select the Merchant Center account that should receive the Shopify product feed.",

  "Google Ads Remarketing":
    "Enable Google Ads remarketing and configure the Shopify ecommerce events and product identifiers used for remarketing.",

  "Meta Business Portfolio":
    "Select the Meta Business Portfolio that owns the Dataset / Pixel used for this Shopify store.",

  "Meta Dataset / Pixel":
    "Select the Meta Dataset / Pixel that should receive browser Pixel events and supported server-side Conversions API events.",

  "TikTok Ad Account":
    "Select the TikTok Ads account used by this Shopify store.",

  "TikTok Pixel":
    "Select the TikTok Pixel that should receive supported client-side Shopify events.",

  "TikTok Events API Destination":
    "Select the TikTok Events API destination used for supported server-side event delivery.",

  "TikTok Catalog":
    "Select the TikTok product catalog associated with this store when catalog functionality is available.",

  "Pinterest Ad Account":
    "Select the Pinterest advertising account used for this store.",

  "Pinterest Tag":
    "Select the Pinterest Tag used for supported conversion and audience tracking.",

  "Pinterest Catalog":
    "Select the Pinterest catalog used for product matching and catalog advertising.",

  "Microsoft Ads Account":
    "Select the Microsoft Advertising account that should receive conversion data.",

  "Microsoft UET Tag":
    "Select the Microsoft UET tag used for website events, audiences, and Microsoft Ads conversion goals.",

  "Microsoft Merchant Center":
    "Select the Microsoft Merchant Center store used for product advertising.",

  "LinkedIn Ad Account":
    "Select the LinkedIn Campaign Manager account used for this Shopify store.",

  "LinkedIn Insight Tag":
    "Select the LinkedIn Insight Tag used for supported browser-side tracking.",

  "LinkedIn Conversion Rule":
    "Select the LinkedIn conversion rule used for supported conversion reporting.",

  "Selected GA4 Property":
    "Shows the GA4 property currently selected for this Shopify store.",

  "GA4 Data Stream / Measurement ID":
    "Select the GA4 web stream for this store. The Measurement ID normally starts with G- and identifies where GA4 events are sent.",

  "GA4 Measurement ID":
    "Enter the GA4 web Measurement ID, normally beginning with G-. Use this when the web stream could not be discovered automatically.",

  "GA4 Delivery Mode":
    "Client-side sends events through the Shopify Customer Events browser pixel. Server-side sends supported selected events from the DH Conversions backend using GA4 Measurement Protocol.",

  "GA4 API Secret":
    "Required for GA4 server-side Measurement Protocol delivery. Create the API Secret for the selected GA4 web stream.",

  "GA4 Item ID Format":
    "Controls the item_id format sent with GA4 ecommerce events. For product matching, use the same format as Merchant Center and Google Ads remarketing.",

  "GA4 Events to Send":
    "Select the Shopify ecommerce events that should be delivered to GA4.",

  "Selected Google Ads Account":
    "Shows the Google Ads customer account where conversion actions will be created or reused.",

  "Conversion Event":
    "Select the Shopify event that should trigger this Google Ads conversion action. Purchase is normally used for sales and Lead for lead generation.",

  "Conversion Name":
    "Optional. If you enter a custom name, DH Conversions uses that exact name in Google Ads. Leave it blank to use the default DH - Event Name format.",

  "Goal Role":
    "Primary conversions are normally used for bidding and the Conversions column. Secondary conversions are generally used for observation and All conversions.",

  "Conversion Value":
    "Dynamic uses the Shopify event or order value. Fixed uses a configured default. No value is for conversions where monetary value is not required.",

  "Google Ads Item ID Format":
    "Controls product IDs sent with Google Ads ecommerce data. Match this format to the Merchant Center offer ID format.",

  "Google Ads Delivery Mode":
    "Client-side uses browser-side Google tagging. Server-side sends supported conversion data from the application backend using Google APIs.",

  "Remarketing Item ID Format":
    "Select the product identifier format used by Google Ads remarketing. It should match Merchant Center product IDs.",

  "Remarketing Events":
    "Select which Shopify ecommerce interactions should be used for Google Ads remarketing.",

  "Dataset / Pixel":
    "Select the Meta Dataset / Pixel used for this Shopify store.",

  "Meta Test Event Code":
    "Optional code from Meta Events Manager. Use it while testing supported CAPI events in the Meta Test Events view.",

  "Meta CAPI Access Token":
    "Required for Meta server-side Conversions API delivery. Use a token authorized for the selected Dataset / Pixel.",

  "Content ID / Product ID Format":
    "Controls Meta content_ids. Use the same format for Meta Pixel, CAPI, and the corresponding Meta catalog.",

  "Meta Delivery Options":
    "Client-side Meta Pixel sends browser events. Server-side Meta CAPI sends supported events from the application backend.",

  "Meta Events":
    "Select the Shopify events that should be sent to the selected Meta Dataset / Pixel.",

  "Selected Merchant Center":
    "Shows the Merchant Center account that will receive the Shopify product feed.",

  "Target Country":
    "Select the target country for the Merchant Center product feed. Countries are shown as Country Name - ISO Code. Choose Custom country code only when needed.",

  "Custom Target Country Code":
    "Enter a valid two-letter country or territory code. This field appears only when Custom country code is selected.",

  "Product ID Format":
    "Controls the Merchant Center offer ID format. Use the same product identifier format in Google Ads remarketing and other catalog integrations.",

  "Product Channel":
    "Online is for normal ecommerce products sold on the website. Local is for supported local inventory configurations.",

  "Marketing Methods":
    "Choose whether products are intended for Free Listings, Shopping Ads, or both.",

  "Feed Update Schedule":
    "Choose how frequently the Merchant Center feed should be updated when scheduled synchronization is enabled.",

  "Feed Creation Method":
    "Controls which Shopify products are included. The currently supported option uses active in-stock products.",

  "Category / Collection":
    "Used when collection-based feed creation becomes available.",

  "Restricted Products":
    "Restricted or adult-related products are skipped by default. Enable this only when the merchant intentionally wants them included and understands platform policies."
};

function getFieldHelp(platformKey: string, field: string) {
  return (
    FIELD_HELP[`${platformKey}:${field}`] ||
    FIELD_HELP[field] ||
    `Configure the ${field} used by this connected platform.`
  );
}

export default function ConfigurationPage() {
  const {
    shop,
    navQuery,
    connections,
    assets,
    ga4AssetMessage,
    googleAdsAssetMessage,
    shouldLoadGoogleAssets,
    unlockPlatform,
    savedAssetSelections,
    savedAssetSelectionLabels,
    ga4DeliverySettings,
    testModeSettings,
    webPixelStatus,
    googleAdsConversionActions,
  } = useLoaderData<typeof loader>();

  /*
   * Keep successful Google discovery results alive while the
   * loadGoogleAssets/loadGa4Assets query parameters are removed.
   *
   * React Router performs another loader request after navigate()
   * cleans the URL. Normal loader requests deliberately return
   * empty Google asset arrays, so without this cache the freshly
   * discovered GA4 / Google Ads / Merchant Center options vanish.
   */
  const [cachedGoogleAssets, setCachedGoogleAssets] =
    useState(() => ({
      ga4Properties: assets.google.ga4Properties || [],
      ga4DataStreams: assets.google.ga4DataStreams || [],
      googleAdsAccounts: assets.google.googleAdsAccounts || [],
      merchantCenters: assets.google.merchantCenters || [],
    }));

  useEffect(() => {
    setCachedGoogleAssets((current) => ({
      ga4Properties:
        assets.google.ga4Properties?.length
          ? assets.google.ga4Properties
          : current.ga4Properties,

      ga4DataStreams:
        assets.google.ga4DataStreams?.length
          ? assets.google.ga4DataStreams
          : current.ga4DataStreams,

      googleAdsAccounts:
        assets.google.googleAdsAccounts?.length
          ? assets.google.googleAdsAccounts
          : current.googleAdsAccounts,

      merchantCenters:
        assets.google.merchantCenters?.length
          ? assets.google.merchantCenters
          : current.merchantCenters,
    }));
  }, [
    assets.google.ga4Properties,
    assets.google.ga4DataStreams,
    assets.google.googleAdsAccounts,
    assets.google.merchantCenters,
  ]);

  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const withNav = (path: string) => {
    const [basePath, existingQuery = ""] = path.split("?");
    const params = new URLSearchParams(existingQuery);
    const navParams = new URLSearchParams(navQuery || location.search);

    if (!navParams.get("shop")) {
      navParams.set("shop", shop);
    }

    navParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });

    return `${basePath}?${params.toString()}`;
  };
  const [activeModal, setActiveModal] = useState<"ga4" | "conversions" | "feed" | "remarketing" | "metaBusiness" | "metaDataset" | null>(null);
  const conversionFetcher = useFetcher();
  const deleteConversionFetcher = useFetcher();
  const deleteConversionResult = deleteConversionFetcher.data as
    | { ok?: boolean; error?: string; message?: string }
    | undefined;
  const conversionResult = conversionFetcher.data as
    | {
        ok?: boolean;
        error?: string;
        message?: string;
        details?: string;
      }
    | undefined;
  const [selectedAssets, setSelectedAssets] =
    useState<Record<string, string>>(savedAssetSelections || {});

  const [unlockedAssetFields, setUnlockedAssetFields] =
    useState<Set<string>>(() => {
      /*
       * Google Connect/Reconnect uses unlockPlatform=google
       * only as a transient navigation marker.
       *
       * A successful OAuth reconnect must not temporarily
       * unlock already-selected Google destinations.
       *
       * Fields with no saved selection remain selectable
       * through the normal field-locking logic.
       */
      const fields =
        unlockPlatform === "meta"
          ? [
              "Meta Business Portfolio",
              "Meta Dataset / Pixel",
            ]
          : [];

      return new Set(
        fields.map((field) => `${unlockPlatform}:${field}`)
      );
    });

  useEffect(() => {
    if (!unlockPlatform || typeof window === "undefined") {
      return;
    }

    /*
     * IMPORTANT:
     *
     * Use React Router navigation rather than history.replaceState().
     * Raw browser history replacement changes the visible URL but does
     * not reliably update React Router's internal location. Fetcher POSTs
     * and revalidations could therefore continue carrying
     * loadGoogleAssets=true and repeatedly trigger Google API discovery.
     */
    const currentUrl = new URL(window.location.href);

    currentUrl.searchParams.delete("unlockPlatform");
    currentUrl.searchParams.delete("loadGoogleAssets");
    currentUrl.searchParams.delete("loadGa4Assets");
    currentUrl.searchParams.delete("loadMetaAssets");

    navigate(
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      { replace: true }
    );
  }, [unlockPlatform, navigate]);


  useEffect(() => {
    setSelectedAssets(
      savedAssetSelections || {}
    );

    setTestModeEnabled(
      Boolean(
        testModeSettings?.enabled
      )
    );

    setGa4DeliveryMode(
      ga4DeliverySettings
        ?.setting
        ?.deliveryMode ===
        "server"
        ? "server"
        : "client"
    );

    const savedTokenPreview =
      String(
        savedAssetSelections?.[
          "meta:Meta CAPI Access Token"
        ] || ""
      );

    /*
     * The browser receives only the masked preview,
     * never the complete stored token.
     */
    setMetaCapiAccessTokenInput(
      savedTokenPreview
    );

    setMetaCapiAccessTokenSavedOverride(
      Boolean(
        savedTokenPreview
      )
    );
  }, [
    savedAssetSelections,
    testModeSettings?.enabled,
    ga4DeliverySettings?.setting?.deliveryMode,
  ]);

  /*
   * Do not revalidate Configuration merely because
   * the merchant switches browser tabs.
   *
   * This protects unsaved Meta Test Event Codes,
   * access tokens, event choices and delivery settings.
   * Successful actions still trigger normal router
   * revalidation.
   */

  const assetSelectionFetcher = useFetcher();

  const savedGoogleAdsAccountValue =
    selectedAssets[
      "google:Google Ads Account / Manager Account"
    ] || "";

  const discoveredGoogleAdsAccounts: AssetOption[] =
    cachedGoogleAssets.googleAdsAccounts || [];

  const savedGoogleAdsAccountLabel =
    savedAssetSelectionLabels[
      "google:Google Ads Account / Manager Account"
    ] ||
    (savedGoogleAdsAccountValue
      ? `Google Ads Account ${savedGoogleAdsAccountValue}`
      : "");

  /*
   * Ordinary settings-page loads intentionally do not call the
   * Google Ads discovery API.
   *
   * If a destination was already saved, keep it visible even
   * when discovery was not requested or Google temporarily
   * returned a rate-limit/API error.
   */
  const validatedGoogleAdsAccounts: AssetOption[] =
    savedGoogleAdsAccountValue &&
    !discoveredGoogleAdsAccounts.some(
      (option) =>
        option.value === savedGoogleAdsAccountValue
    )
      ? [
          {
            value: savedGoogleAdsAccountValue,
            label: savedGoogleAdsAccountLabel,
            loginCustomerId:
              selectedAssets[
                "google:Google Ads Login Customer ID"
              ] === "none"
                ? ""
                : selectedAssets[
                    "google:Google Ads Login Customer ID"
                  ] || "",
          },
          ...discoveredGoogleAdsAccounts,
        ]
      : discoveredGoogleAdsAccounts;

  const googleAdsAccountStillAvailable =
    Boolean(
      savedGoogleAdsAccountValue &&
      validatedGoogleAdsAccounts.some(
        (option) =>
          option.value ===
          savedGoogleAdsAccountValue
      )
    );

  /*
   * Keep the persisted Google Ads destination unless the merchant
   * explicitly changes/reconnects it.
   *
   * An empty discovery result can mean timeout, rate limiting,
   * temporary Google API failure, or permission failure for only
   * some accessible customers. It must never silently delete a
   * previously saved conversion destination.
   */
  const googleAdsAccountValue =
    savedGoogleAdsAccountValue || "";

  /*
   * During an explicit discovery request we can still tell whether
   * the stored customer appeared in Google's latest successful list.
   * This is informational only; it is deliberately NOT destructive.
   */
  const googleAdsSavedAccountValidated =
    !savedGoogleAdsAccountValue ||
    !shouldLoadGoogleAssets ||
    googleAdsAccountStillAvailable;

  void googleAdsSavedAccountValidated;


  const metaBusinessFetcher = useFetcher();

  const metaBusinessResult =
    metaBusinessFetcher.data as
      | {
          ok?: boolean;
          saved?: boolean;
          syncFailed?: boolean;
          warning?: string;
          error?: string;
          message?: string;
        }
      | undefined;

  const [
    metaBusinessDrafting,
    setMetaBusinessDrafting,
  ] = useState(false);

  const metaDatasetFetcher = useFetcher();

  const metaDatasetResult =
    metaDatasetFetcher.data as
      | {
          ok?: boolean;
          saved?: boolean;
          syncFailed?: boolean;
          warning?: string;
          error?: string;
          message?: string;
        }
      | undefined;

  const metaBusinessOptions =
    assets.meta?.businessPortfolios || [];
  const metaBusinessKey = "meta:Meta Business Portfolio";
  const metaBusinessValue = selectedAssets[metaBusinessKey] || "";
  const selectedMetaBusinessLabel =
    metaBusinessOptions.find((option) => option.value === metaBusinessValue)?.label ||
    metaBusinessValue ||
    "";

  const metaDatasetOptions = assets.meta?.datasetsPixels || [];
  const metaDatasetKey = "meta:Meta Dataset / Pixel";
  const metaDatasetValue = selectedAssets[metaDatasetKey] || "";
  const metaBusinessLocked =
    isLockedAssetField(
      "meta",
      "Meta Business Portfolio",
      metaBusinessValue
    );

  /*
   * Existing persisted Portfolio:
   *   locked + no local draft
   *
   * Newly saved Portfolio:
   *   fetcher must confirm success first.
   */
  const metaBusinessConfirmed =
    !metaBusinessDrafting &&
    metaBusinessFetcher.state === "idle" &&
    (
      metaBusinessResult
        ? Boolean(
            metaBusinessResult.ok ||
            metaBusinessResult.saved
          )
        : metaBusinessLocked
    );
  const metaDatasetLocked = isLockedAssetField(
    "meta",
    "Meta Dataset / Pixel",
    metaDatasetValue
  );
  const selectedMetaDatasetLabel =
    metaDatasetOptions.find((option) => option.value === metaDatasetValue)?.label ||
    metaDatasetValue ||
    "";

  const metaEventsKey = "meta:Meta Selected Events";
  const rawMetaSelectedEvents = selectedAssets[metaEventsKey] || "none";
  const metaSelectedEvents =
    rawMetaSelectedEvents === "none"
      ? []
      : rawMetaSelectedEvents.split(",").map((item) => item.trim()).filter(Boolean);

  const metaClientSideEnabled =
    selectedAssets["meta:Meta Client Side Enabled"] === "true";
  const metaServerSideEnabled =
    selectedAssets["meta:Meta Server Side Enabled"] === "true";
  const metaTestEventCode =
    selectedAssets["meta:Meta Test Event Code"] === "none" || selectedAssets["meta:Meta Test Event Code"] === "__configured__"
      ? ""
      : selectedAssets["meta:Meta Test Event Code"] || "";

  const metaContentIdFormat =
    selectedAssets["meta:Meta Content ID Format"] || "shopify_country_product_variant";

  const [metaCapiAccessTokenInput, setMetaCapiAccessTokenInput] = useState("");
  const [metaCapiAccessTokenSavedOverride, setMetaCapiAccessTokenSavedOverride] = useState(false);

  const metaCapiAccessTokenSaved =
    Boolean(selectedAssets["meta:Meta CAPI Access Token"]) || metaCapiAccessTokenSavedOverride;

  const metaCapiAccessTokenLabel =
    metaCapiAccessTokenSaved
      ? "Access token saved"
      : "No CAPI access token saved";

  /*
   * SAVED BASELINE
   *
   * Used to decide whether the primary button should
   * say Close or Save.
   */
  const savedMetaDatasetValue =
    String(
      savedAssetSelections[
        "meta:Meta Dataset / Pixel"
      ] || ""
    );

  const savedMetaEvents =
    String(
      savedAssetSelections[
        "meta:Meta Selected Events"
      ] || "none"
    );

  const savedMetaClientSide =
    String(
      savedAssetSelections[
        "meta:Meta Client Side Enabled"
      ] || "false"
    );

  const savedMetaServerSide =
    String(
      savedAssetSelections[
        "meta:Meta Server Side Enabled"
      ] || "false"
    );

  const savedMetaTestEventCode =
    String(
      savedAssetSelections[
        "meta:Meta Test Event Code"
      ] || "none"
    );

  const savedMetaTestEventCodeValue =
    savedMetaTestEventCode ===
      "none"
      ? ""
      : savedMetaTestEventCode;

  const savedMetaContentIdFormat =
    String(
      savedAssetSelections[
        "meta:Meta Content ID Format"
      ] ||
      "shopify_country_product_variant"
    );

  const savedMetaCapiAccessTokenPreview =
    String(
      savedAssetSelections[
        "meta:Meta CAPI Access Token"
      ] || ""
    );

  const normalizeMetaEventList = (
    value: string
  ) => {
    const events =
      String(
        value || "none"
      )
        .split(",")
        .map(
          (item) =>
            item.trim()
        )
        .filter(
          (item) =>
            item &&
            item !== "none"
        )
        .sort();

    return events.length
      ? events.join(",")
      : "none";
  };

  const metaDatasetHasSavedConfig =
    Boolean(
      savedMetaDatasetValue
    );

  const metaDatasetIsDirty =
    metaDatasetValue !==
      savedMetaDatasetValue ||

    normalizeMetaEventList(
      rawMetaSelectedEvents
    ) !==
      normalizeMetaEventList(
        savedMetaEvents
      ) ||

    (
      metaClientSideEnabled
        ? "true"
        : "false"
    ) !==
      savedMetaClientSide ||

    (
      metaServerSideEnabled
        ? "true"
        : "false"
    ) !==
      savedMetaServerSide ||

    metaTestEventCode !==
      savedMetaTestEventCodeValue ||

    metaContentIdFormat !==
      savedMetaContentIdFormat ||

    metaCapiAccessTokenInput !==
      savedMetaCapiAccessTokenPreview;

  const feedFetcher = useFetcher();
  const feedResult = feedFetcher.data as
    | {
        ok?: boolean;
        error?: string;
        message?: string;
        details?: string;
        result?: {
          total?: number;
          uploaded?: number;
          failed?: number;
        };
      }
    | undefined;
  const ga4DeliveryFetcher = useFetcher();
  const ga4DeliveryResult = ga4DeliveryFetcher.data as
    | { ok?: boolean; error?: string; message?: string; apiSecretConfigured?: boolean }
    | undefined;
  const testModeFetcher = useFetcher();
  const pixelFetcher = useFetcher();
  const pixelResult = pixelFetcher.data as
    | {
        ok?: boolean;
        pixelDeactivated?: boolean;
        message?: string;
        error?: string;
      }
    | undefined;

  const pixelExists = Boolean(
    webPixelStatus?.pixelExists,
  );

  const pixelConnected = Boolean(
    webPixelStatus?.pixelExists &&
      webPixelStatus?.ingestKeyConfigured,
  );
  const testModeResult = testModeFetcher.data as
    | { ok?: boolean; error?: string; message?: string; testModeEnabled?: boolean }
    | undefined;
  const [testModeEnabled, setTestModeEnabled] = useState(Boolean(testModeSettings?.enabled));
  const [ga4DeliveryMode, setGa4DeliveryMode] = useState(
    ga4DeliverySettings?.setting?.deliveryMode === "server" ? "server" : "client"
  );

  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedTargetCountry, setFeedTargetCountry] = useState("US");
  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedCustomTargetCountry, setFeedCustomTargetCountry] = useState("");
  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedProductIdFormat, setFeedProductIdFormat] = useState("shopify_country_product_variant");
  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedChannel, setFeedChannel] = useState("online");
  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedMarketingMethod, setFeedMarketingMethod] = useState("all");
  // Reserved for the upcoming catalog/feed configuration UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [feedIncludeRestrictedProducts, setFeedIncludeRestrictedProducts] = useState(false);

  const savedGa4PropertyValue =
    selectedAssets["google:GA4 Property"] || "";

  const discoveredGa4Properties: AssetOption[] =
    cachedGoogleAssets.ga4Properties || [];

  const savedGa4PropertyLabel =
    savedAssetSelectionLabels[
      "google:GA4 Property"
    ] ||
    (savedGa4PropertyValue
      ? `GA4 Property ${savedGa4PropertyValue}`
      : "");

  /*
   * Normal settings-page loads intentionally skip Google API
   * discovery. Preserve the persisted GA4 property in the
   * dropdown so the UI does not become blank after the
   * loadGa4Assets/loadGoogleAssets query parameter is removed.
   */
  const validatedGa4Properties: AssetOption[] =
    savedGa4PropertyValue &&
    !discoveredGa4Properties.some(
      (option) =>
        option.value === savedGa4PropertyValue
    )
      ? [
          {
            value: savedGa4PropertyValue,
            label: savedGa4PropertyLabel,
          },
          ...discoveredGa4Properties,
        ]
      : discoveredGa4Properties;

  const ga4PropertyValue =
    savedGa4PropertyValue;

  const ga4ApiSecretConfigured =
    ga4DeliveryResult?.apiSecretConfigured ??
    isGa4ApiSecretConfigured(ga4DeliverySettings?.credential?.tokenStatus);
  const googleAdsLoginCustomerId =
    selectedAssets[
      "google:Google Ads Login Customer ID"
    ] === "none"
      ? ""
      : selectedAssets[
          "google:Google Ads Login Customer ID"
        ] || "";

  const merchantCenterValue =
    selectedAssets["google:Google Merchant Center"] || "";
  const googleRemarketingValue =
    selectedAssets["google:Google Ads Remarketing"] || "";
  const clientSideStatus =
    googleAdsAccountValue || ga4PropertyValue || googleRemarketingValue === "enabled"
      ? "Active"
      : "Pending";
  const serverSideStatus =
    googleAdsConversionActions.length > 0
      ? "Active"
      : "Pending conversion configuration";

  const emptyGoogleConversionForm = {
    recordId: "",
    eventName: "",
    conversionName: "",
    isPrimary: "true",
    conversionValueMode: "dynamic",
    deliveryMode: "client",
  };

  const [googleConversionForm, setGoogleConversionForm] = useState(emptyGoogleConversionForm);

  function resetGoogleConversionForm() {
    setGoogleConversionForm(emptyGoogleConversionForm);
  }

  function updateGoogleConversionForm(field: string, value: string) {
    setGoogleConversionForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function editGoogleConversion(conversion: {
    id: string;
    eventName: string;
    conversionName?: string | null;
    isPrimary?: boolean | null;
    deliveryMode?: string | null;
  }) {
    setGoogleConversionForm({
      recordId: conversion.id,
      eventName: conversion.eventName || "",
      conversionName: conversion.conversionName || "",
      isPrimary: conversion.isPrimary === false ? "false" : "true",
      conversionValueMode: "dynamic",
      deliveryMode: conversion.deliveryMode === "server" ? "server" : "client",
    });
  }

  const merchantCountryCodes =
    "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB UM US UY UZ VU VE VN VG VI WF EH YE ZM ZW"
      .split(" ")
      .filter(Boolean);

  const merchantRegionNames =
    typeof Intl !== "undefined" &&
    typeof Intl.DisplayNames !== "undefined"
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;

  const merchantCountryOptions =
    merchantCountryCodes
      .map((code) => ({
        code,
        name: merchantRegionNames?.of(code) || code,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      );

  function fieldKey(platformKey: string, field: string) {
    return `${platformKey}:${field}`;
  }

  function isLockedAssetField(
    platformKey: string,
    field: string,
    value: string
  ) {
    if (!value) {
      return false;
    }

    if (unlockedAssetFields.has(fieldKey(platformKey, field))) {
      return false;
    }

    const googleField =
      platformKey === "google" &&
      [
        "GA4 Property",
        "Google Ads Account / Manager Account",
        "Google Merchant Center",
      ].includes(field);

    const metaField =
      platformKey === "meta" &&
      [
        "Meta Business Portfolio",
        "Meta Dataset / Pixel",
      ].includes(field);

    return googleField || metaField;
  }

  function lockAssetField(platformKey: string, field: string) {
    const key = fieldKey(platformKey, field);

    setUnlockedAssetFields((previous) => {
      if (!previous.has(key)) {
        return previous;
      }

      const next = new Set(previous);
      next.delete(key);

      return next;
    });
  }

  function settingKey(platformKey: string, field: string, setting: string) {
    return `${platformKey}:${field}:${setting}`;
  }

  function isSelectionActivatedGoogleField(
    platformKey: string,
    field: string
  ) {
    return (
      platformKey === "google" &&
      [
        "GA4 Property",
        "Google Ads Account / Manager Account",
        "Google Merchant Center",
      ].includes(field)
    );
  }

  function isTrackingFeatureEnabled(
    platformKey: string,
    field: string
  ) {
    const enabledKey = settingKey(
      platformKey,
      field,
      "enabled"
    );

    const mainKey = fieldKey(
      platformKey,
      field
    );

    /*
     * GA4, Google Ads, and Merchant Center use the
     * selected asset itself as the activation state.
     *
     * There is no separate Enable checkbox for these
     * destinations anymore.
     */
    if (
      isSelectionActivatedGoogleField(
        platformKey,
        field
      )
    ) {
      return Boolean(
        selectedAssets[mainKey]
      );
    }

    /*
     * Google Ads Remarketing remains optional and
     * therefore keeps its own Enable checkbox.
     */
    if (
      platformKey === "google" &&
      field === "Google Ads Remarketing"
    ) {
      return (
        selectedAssets[mainKey] ===
        "enabled"
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        selectedAssets,
        enabledKey
      )
    ) {
      return (
        selectedAssets[enabledKey] ===
        "true"
      );
    }

    if (selectedAssets[mainKey]) {
      return true;
    }

    return false;
  }

  // Reserved for the upcoming per-platform server-side UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function supportsServerSide(platformKey: string, field: string) {
    return (
      platformKey === "google" &&
      [
        "GA4 Property",
        "Google Ads Account / Manager Account",
        "Google Ads Remarketing",
      ].includes(field)
    );
  }

  // Reserved for the upcoming per-platform server-side UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function isServerSideEnabled(platformKey: string, field: string) {
    return selectedAssets[settingKey(platformKey, field, "server_side")] === "true";
  }

  function getFeatureLabel(field: string) {
    if (field === "Google Ads Remarketing") {
      return "Enable Google Ads remarketing";
    }

    return `Enable ${field}`;
  }

  function saveSetting(platformKey: string, assetType: string, assetValue: string, assetLabel: string) {
    const key = `${platformKey}:${assetType}`;

    setSelectedAssets((previous) => ({
      ...previous,
      [key]: assetValue,
    }));

    assetSelectionFetcher.submit(
      {
        _action: "save_asset_selection",
        platform: platformKey,
        assetType,
        assetValue,
        assetLabel,
      },
      { method: "post" }
    );
  }

  const remarketingEventOptions = [
    { value: "page_view", label: "Page View" },
    { value: "view_item_list", label: "View Item List" },
    { value: "view_item", label: "View Item" },
    { value: "add_to_cart", label: "Add To Cart" },
    { value: "remove_from_cart", label: "Remove From Cart" },
    { value: "view_cart", label: "View Cart" },
    { value: "begin_checkout", label: "Begin Checkout" },
    { value: "add_shipping_info", label: "Add Shipping Info" },
    { value: "add_payment_info", label: "Add Payment Info" },
    { value: "purchase", label: "Purchase" },
    { value: "search", label: "Search" },
  ];

  const ga4EventOptions = [
    { value: "page_view", label: "Page View" },
    { value: "view_item_list", label: "View Item List" },
    { value: "view_item", label: "View Item" },
    { value: "add_to_cart", label: "Add To Cart" },
    { value: "remove_from_cart", label: "Remove From Cart" },
    { value: "view_cart", label: "View Cart" },
    { value: "begin_checkout", label: "Begin Checkout" },
    { value: "add_contact_info", label: "Add Contact Info" },
    { value: "add_shipping_info", label: "Add Shipping Info" },
    { value: "add_payment_info", label: "Add Payment Info" },
    { value: "purchase", label: "Purchase" },
    { value: "search", label: "Search" },
  ];

  const itemIdFormatOptions = [
    {
      value: "shopify_country_product_variant",
      label: "Shopify_COUNTRY_PRODUCTID_VARIANTID",
    },
    {
      value: "product_variant",
      label: "PRODUCTID_VARIANTID",
    },
    {
      value: "product_id",
      label: "PRODUCTID only",
    },
    {
      value: "variant_id",
      label: "VARIANTID only",
    },
    {
      value: "sku",
      label: "SKU",
    },
  ];

  function getSelectedCsvSetting(settingName: string) {
    return String(selectedAssets[settingName] || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function updateCsvSetting(
    platformKey: string,
    assetType: string,
    eventName: string,
    checked: boolean
  ) {
    const settingName = `${platformKey}:${assetType}`;
    const current = new Set(getSelectedCsvSetting(settingName));

    if (checked) {
      current.add(eventName);
    } else {
      current.delete(eventName);
    }

    const nextEvents = Array.from(current);

    saveSetting(
      platformKey,
      assetType,
      nextEvents.join(","),
      nextEvents.join(", ")
    );
  }

  function getItemIdFormat(platformKey: string, assetType: string) {
    return selectedAssets[`${platformKey}:${assetType}:item_id_format`] || "shopify_country_product_variant";
  }

  function saveItemIdFormat(platformKey: string, assetType: string, itemIdFormat: string) {
    const label =
      itemIdFormatOptions.find((option) => option.value === itemIdFormat)?.label ||
      itemIdFormat;

    saveSetting(
      platformKey,
      `${assetType}:item_id_format`,
      itemIdFormat,
      label
    );
  }

  function getSelectedRemarketingEvents() {
    return String(selectedAssets["google:Google Ads Remarketing:events"] || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // Reserved for the upcoming remarketing event selector.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function updateRemarketingEvent(eventName: string, checked: boolean) {
    const current = new Set(getSelectedRemarketingEvents());

    if (checked) {
      current.add(eventName);
    } else {
      current.delete(eventName);
    }

    const nextEvents = Array.from(current);

    saveSetting(
      "google",
      "Google Ads Remarketing:events",
      nextEvents.join(","),
      nextEvents.join(", ")
    );
  }

  function getFieldOptions(platformKey: string, field: string): AssetOption[] {
    if (platformKey === "google" && field === "GA4 Property") {
      return validatedGa4Properties;
    }

    if (platformKey === "google" && field === "Google Ads Account / Manager Account") {
      return assets.google.googleAdsAccounts;
    }

    if (platformKey === "google" && field === "Google Merchant Center") {
      return cachedGoogleAssets.merchantCenters;
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
<h1
          style={{
            ...styles.title,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 28,
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          <img
            src="/assets/logos/dh-logo.png"
            alt="DH Conversions"
            style={{
              height: 36,
              width: "auto",
              maxWidth: 96,
              objectFit: "contain",
              display: "block",
              flexShrink: 0,
            }}
          />
          <span>Configuration</span>
        </h1>
        {testModeEnabled && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              width: "fit-content",
              marginTop: 12,
              borderRadius: 999,
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#9a3412",
              background: "#fed7aa",
              border: "1px solid #fdba74",
            }}
          >
            TEST MODE ACTIVE
          </div>
        )}
        <p style={styles.subtitle}>
          Select connected platform assets, configure conversions, and create catalog feeds.
        </p>
      </section>

      <section style={styles.notice}>
        Tracking IDs, conversion labels, pixels, catalogs, and feed settings will be selected from connected platform accounts.
        Manual ID entry is not required.
      </section>

      <section
        style={{
          ...styles.statusBox,
          borderColor: testModeEnabled ? "#fb923c" : "#d1d5db",
          background: testModeEnabled ? "#fff7ed" : "white",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={styles.sectionTitle}>Test / Debug Mode</h2>
            <p style={{ margin: "6px 0 0", color: "#4b5563", lineHeight: 1.6 }}>
              Use platform-specific testing and validation methods. Test behavior differs by platform.
            </p>
          </div>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 999,
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: testModeEnabled ? "#9a3412" : "#166534",
              background: testModeEnabled ? "#fed7aa" : "#dcfce7",
              border: testModeEnabled ? "1px solid #fdba74" : "1px solid #86efac",
            }}
          >
            {testModeEnabled ? "Test Mode Active" : "Live Mode"}
          </span>
        </div>

        <testModeFetcher.Form
          method="post"
          style={{
            marginTop: 18,
            display: "grid",
            gap: 12,
          }}
        >
          <input type="hidden" name="_action" value="save_test_mode" />

          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontWeight: 700,
              color: "#111827",
            }}
          >
            <input
              type="checkbox"
              name="enabled"
              value="true"
              checked={testModeEnabled}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                if (checked && !window.confirm("Enable Test / Debug Mode?\n\nPlatform behavior differs. Google Ads validation requests will not be recorded, while some platforms may still process events. Disable test mode after testing.")) return;
                setTestModeEnabled(checked);
              }}
              style={{ marginTop: 3 }}
            />
            <span>
              Enable Test / Debug Mode
              <small
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "#6b7280",
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}
              >
                Platform behavior differs. Google Ads validation requests will not be recorded, while some platforms may still process events. Disable test mode after testing.
              </small>
            </span>
          </label>

          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["GA4", [["ga4_client", "Client-side"], ["ga4_server", "Server-side Measurement Protocol"]]],
              ["Google Ads", [["google_ads_client", "Client-side"], ["google_ads_server", "Server-side Data Manager API"]]],
              ["Meta", [["meta_pixel", "Meta Pixel"], ["meta_capi", "Meta Conversions API"]]],
            ].map(([platform, channels]) => (
              <div key={String(platform)} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                <strong>{platform}</strong>
                {(channels as string[][]).map(([channel, label]) => {
                  const saved = testModeSettings?.channels?.[channel];
                  return <div key={channel} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginTop: 8 }}>
                    <label><input type="checkbox" name="selectedChannels" value={channel} defaultChecked={Boolean(saved?.selected)} /> {label}</label>
                    <select name={`override:${channel}`} defaultValue={saved?.override || "GLOBAL"}>
                      <option value="GLOBAL">Use Global Test Mode</option>
                      <option value="ENABLED">Enabled</option>
                      <option value="DISABLED">Disabled</option>
                    </select>
                  </div>;
                })}
              </div>
            ))}
          </div>

          <p style={{ margin: 0, color: "#4b5563" }}>GA4 debug events appear in DebugView. They may still enter reporting unless developer traffic is filtered or a separate test property is used.</p>
          <p style={{ margin: 0, color: "#4b5563" }}>Meta test events may still be processed by Meta. Use test values, a test data source, or a dedicated test setup.</p>

          {testModeResult?.message && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                color: testModeResult.ok ? "#166534" : "#991b1b",
                background: testModeResult.ok ? "#dcfce7" : "#fee2e2",
                border: testModeResult.ok ? "1px solid #86efac" : "1px solid #fecaca",
                fontWeight: 700,
              }}
            >
              {testModeResult.message}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={testModeFetcher.state !== "idle"}
              style={{
                ...styles.primaryButton,
                border: "none",
                cursor: testModeFetcher.state === "idle" ? "pointer" : "not-allowed",
                opacity: testModeFetcher.state === "idle" ? 1 : 0.7,
              }}
            >
              {testModeFetcher.state === "idle" ? "Save Test Mode" : "Saving..."}
            </button>
          </div>
        </testModeFetcher.Form>
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

            <strong
              style={
                pixelConnected
                  ? styles.pixelStatusConnected
                  : styles.pixelStatusDisconnected
              }
            >
              {pixelConnected
                ? "Active / Connected"
                : "Not Active / Not Connected"}
            </strong>
          </div>
        </div>

        {pixelExists && !pixelConnected ? (
          <p style={styles.pixelWarningText}>
            The Shopify pixel exists, but its installation
            settings need to be refreshed.
          </p>
        ) : null}

        {pixelResult?.message ? (
          <p style={styles.pixelSuccessText}>
            {pixelResult.message}
          </p>
        ) : null}

        {pixelResult?.error ? (
          <p style={styles.pixelErrorText}>
            {pixelResult.error}
          </p>
        ) : null}

        <div style={styles.buttonRow}>
          <Link
            to={withNav("/app/activate-pixel")}
            style={styles.primaryButton}
          >
            {pixelExists ? "Refresh Pixel" : "Activate Pixel"}
          </Link>

          {pixelExists ? (
            <pixelFetcher.Form
              method="post"
              onSubmit={(event) => {
                const confirmed = window.confirm(
                  "Deactivate the DH Conversions web pixel? Storefront browser events will stop until it is activated again.",
                );

                if (!confirmed) {
                  event.preventDefault();
                }
              }}
            >
              <input
                type="hidden"
                name="_action"
                value="deactivate_web_pixel"
              />

              <button
                type="submit"
                disabled={pixelFetcher.state !== "idle"}
                style={{
                  ...styles.dangerButton,
                  cursor:
                    pixelFetcher.state === "idle"
                      ? "pointer"
                      : "not-allowed",
                  opacity:
                    pixelFetcher.state === "idle"
                      ? 1
                      : 0.7,
                }}
              >
                {pixelFetcher.state === "idle"
                  ? "Deactivate Pixel"
                  : "Deactivating..."}
              </button>
            </pixelFetcher.Form>
          ) : null}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Platform Asset Configuration</h2>
        <p style={styles.helpText}>
          GA4, Google Ads, Merchant Center, Meta Business Portfolio, datasets/pixels, and supported platform assets appear only after the platform is connected.
        </p>

        <div style={styles.grid}>
          {platformConfigs
            .filter((platform) =>
              ["google", "meta"].includes(platform.key)
            )
            .map((platform) => {
            const connection = connections[platform.key as keyof typeof connections];
            const isConnected = connection?.connected;
            const returnPath =
              platform.key === "google"
                ? "/app/settings?unlockPlatform=google&loadGoogleAssets=true"
                : platform.key === "meta"
                  ? "/app/settings?unlockPlatform=meta&loadMetaAssets=true"
                  : "/app/settings";

            const oauthParams = new URLSearchParams({
              shop,
              returnPath,
            });

            const oauthUrl =
              `${platform.oauthPath}?${oauthParams.toString()}`;

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

                {isConnected && platform.key === "meta" && (
                  <div style={styles.fieldStack}>
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        padding: "12px",
                        border: "1px solid #d1fae5",
                        borderRadius: 12,
                        background: "#f0fdf4",
                      }}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        <FieldLabel text="Business Portfolio" info={FIELD_HELP["Meta Business Portfolio"]} />
                        <span style={{ color: "#6b7280", fontSize: 13 }}>
                          Select the Meta Business Portfolio that owns the Dataset / Pixel.
                        </span>
                        <div style={{ display: "grid", gap: 6 }}>
                          {selectedMetaBusinessLabel ? (
                            <span style={{ color: "#166534", fontSize: 12, fontWeight: 700 }}>
                              Selected: {selectedMetaBusinessLabel}
                            </span>
                          ) : (
                            <span style={{ color: "#92400e", fontSize: 12, fontWeight: 700 }}>
                              No Business Portfolio selected yet.
                            </span>
                          )}

                          {metaBusinessOptions.length > 0 ? (
                            <button
                              type="button"
                              style={styles.inlineActionButton}
                              onClick={() => setActiveModal("metaBusiness")}
                            >
                              Configure Business Portfolio
                            </button>
                          ) : (
                            <div
                              style={{
                                padding: "10px 12px",
                                border: "1px solid #fde68a",
                                borderRadius: 10,
                                background: "#fffbeb",
                                color: "#92400e",
                                fontWeight: 700,
                                lineHeight: 1.6,
                              }}
                            >
                              No Business Portfolios loaded. Reconnect Meta with a user that has access to a Meta Business Portfolio, then reopen this page from Shopify Admin.
                            </div>
                          )}

                          <small style={{ color: "#6b7280", fontWeight: 700 }}>
                            {metaBusinessLocked
                              ? "Locked after saving Dataset / Pixel settings. Disconnect and reconnect Meta to change it."
                              : "Unlocked after Connect/Reconnect. It will lock after Dataset / Pixel settings are saved."}
                          </small>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <FieldLabel text="Dataset / Pixel" info={FIELD_HELP["Dataset / Pixel"]} />
                        <span style={{ color: "#6b7280", fontSize: 13 }}>
                          Configure Dataset / Pixel, Test Event Code, selected events, client-side Pixel, and server-side CAPI.
                        </span>
                        {selectedMetaDatasetLabel ? (
                          <span style={{ color: "#166534", fontSize: 12, fontWeight: 700 }}>
                            Selected: {selectedMetaDatasetLabel}
                          </span>
                        ) : (
                          <span style={{ color: "#92400e", fontSize: 12, fontWeight: 700 }}>
                            No Dataset / Pixel selected yet.
                          </span>
                        )}

                        {!metaBusinessValue ? (
                          <button
                            type="button"
                            style={styles.disabledButton}
                            disabled
                            title="Select and save a Meta Business Portfolio first."
                          >
                            Select Business Portfolio First
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              style={styles.inlineActionButton}
                              onClick={() =>
                                setActiveModal(
                                  "metaDataset"
                                )
                              }
                            >
                              Configure Dataset / Pixel
                            </button>

                            {metaDatasetOptions.length === 0 ? (
                              <small
                                style={{
                                  color: "#92400e",
                                  fontWeight: 700,
                                  lineHeight: 1.5,
                                }}
                              >
                                No Dataset / Pixel is currently
                                loaded. Open the configuration
                                after saving the Business Portfolio
                                to refresh available Meta assets.
                              </small>
                            ) : null}
                          </>
                        )}
                      </div>

                      <div
                        style={{
                          padding: "10px 12px",
                          border: "1px solid #fde68a",
                          borderRadius: 10,
                          background: "#fffbeb",
                          color: "#92400e",
                          fontWeight: 700,
                          lineHeight: 1.6,
                        }}
                      >
                        Meta Catalog setup is disabled for now because Meta rejected the catalog_management OAuth permission.
                        Enable or approve catalog_management in Meta Developer settings before catalog creation and catalog sync.
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                          color: "#4b5563",
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        <div>
                          <strong>Client-side Pixel:</strong> {metaClientSideEnabled ? "Enabled" : "Disabled"}
                        </div>
                        <div>
                          <strong>Server-side CAPI:</strong> {metaServerSideEnabled ? "Enabled" : "Disabled"}
                        </div>
                        <div>
                          <strong>Selected Events:</strong> {metaSelectedEvents.length}
                        </div>
                        <div>
                          <strong>Catalog Status:</strong> Permission required
                        </div>
                        <div>
                          <strong>Content ID Format:</strong> {metaContentIdFormat}
                        </div>
                        <div>
                          <strong>CAPI Access Token:</strong> {metaCapiAccessTokenSaved ? "Saved" : "Missing"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isConnected && platform.key !== "meta" && (
                  <>
                    <div style={styles.fieldStack}>
                      {platform.fields.map((field) => {
                        const key = fieldKey(platform.key, field);
                        const options = getFieldOptions(platform.key, field);
                        const isEnabled = isTrackingFeatureEnabled(platform.key, field);
                        const selectedValue = selectedAssets[key] || "";
                        const isLocked = isLockedAssetField(platform.key, field, selectedValue);
                        const isDisabled = isLocked;
                        const displayOptions =
                          field === "GA4 Property"
                            ? getGa4PropertyDisplayOptions({
                                savedPropertyId: selectedValue,
                                savedPropertyLabel:
                                  savedAssetSelectionLabels?.[key],
                                discoveredProperties: options,
                                locked: isLocked,
                              })
                            : platform.key === "google" &&
                                field ===
                                  "Google Ads Account / Manager Account"
                              ? options
                              : selectedValue &&
                                  !options.some(
                                    (option) =>
                                      option.value ===
                                      selectedValue
                                  )
                                ? [
                                    {
                                      value: selectedValue,
                                      label: selectedValue,
                                    },
                                    ...options,
                                  ]
                                : options;

                        return (
                          <div key={field} style={styles.fieldWithAction}>
                            <div
                              style={{
                                display:
                                  isSelectionActivatedGoogleField(
                                    platform.key,
                                    field
                                  )
                                    ? "none"
                                    : "grid",
                                gap: 8,
                                padding: "10px 12px",
                                border: "1px solid #e5e7eb",
                                borderRadius: 10,
                                backgroundColor: "#f9fafb",
                                width: "100%",
                                boxSizing: "border-box",
                                gridColumn: "1 / 2",
                              }}
                            >
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  fontWeight: 700,
                                  color: "#111827",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  disabled={
                                    platform.key === "google" &&
                                    field ===
                                      "Google Ads Account / Manager Account" &&
                                    !selectedValue
                                  }
                                  onChange={(event) => {
                                    const checked =
                                      event.currentTarget.checked;

                                    if (
                                      platform.key === "google" &&
                                      field === "Google Ads Remarketing"
                                    ) {
                                      saveSetting(
                                        platform.key,
                                        field,
                                        checked ? "enabled" : "disabled",
                                        checked ? "Enabled" : "Disabled"
                                      );

                                      return;
                                    }

                                    if (
                                      platform.key === "google" &&
                                      field ===
                                        "Google Ads Account / Manager Account" &&
                                      checked &&
                                      !selectedValue
                                    ) {
                                      return;
                                    }

                                    saveSetting(
                                      platform.key,
                                      `${field}:enabled`,
                                      checked ? "true" : "false",
                                      checked ? "Enabled" : "Disabled"
                                    );
                                  }}
                                />
                                <FieldLabel
                                  text={getFeatureLabel(field)}
                                  info={getFieldHelp(
                                    platform.key,
                                    field
                                  )}
                                />
                              </label>

                              <small style={{ color: "#6b7280", lineHeight: 1.5 }}>
                              </small>
                            </div>

                            {field !== "Google Ads Remarketing" && (
                              <label style={{ ...styles.label, width: "100%", boxSizing: "border-box", gridColumn: "1 / 2" }}>
                              <FieldLabel
                                text={field}
                                info={getFieldHelp(
                                  platform.key,
                                  field
                                )}
                              />
                              <select
                                value={selectedValue}
                                disabled={isDisabled}
                                title={
                                  isLocked
                                    ? `This asset is locked after selection. Disconnect and reconnect ${platform.name} to change it.`
                                    : undefined
                                }
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  const selectedLabel =
                                    event.currentTarget.options[event.currentTarget.selectedIndex]?.text || "";

                                  setSelectedAssets((previous) => ({
                                    ...previous,
                                    [key]: nextValue,
                                  }));

                                  if (nextValue) {
                                    const selectedOption =
                                      displayOptions.find(
                                        (option) =>
                                          option.value ===
                                          nextValue
                                      ) as AssetOption | undefined;

                                    const loginCustomerId =
                                      platform.key === "google" &&
                                      field ===
                                        "Google Ads Account / Manager Account"
                                        ? selectedOption?.loginCustomerId || ""
                                        : "";

                                    assetSelectionFetcher.submit(
                                      {
                                        _action:
                                          "save_asset_selection",
                                        platform:
                                          platform.key,
                                        assetType:
                                          field,
                                        assetValue:
                                          nextValue,
                                        assetLabel:
                                          selectedLabel,
                                        loginCustomerId,
                                      },
                                      { method: "post" }
                                    );

                                    lockAssetField(
                                      platform.key,
                                      field
                                    );

                                    if (
                                      platform.key === "google" &&
                                      field === "GA4 Property"
                                    ) {
                                      setTimeout(() => {
                                        revalidator.revalidate();
                                      }, 700);
                                    }
                                  }
                                }}
                                style={
                                  isDisabled
                                    ? {
                                        ...styles.select,
                                        backgroundColor: "#f3f4f6",
                                        color: "#6b7280",
                                        cursor: "not-allowed",
                                      }
                                    : styles.select
                                }
                              >
                                <option value="">
                                  {displayOptions.length
                                    ? `Select ${field}`
                                    : field === "GA4 Property"
                                      ? getGa4EmptyOptionText(Boolean(selectedValue))
                                      : getEmptyOptionText(platform.key, field)}
                                </option>

                                {displayOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>

                              {!isEnabled &&
                                !isSelectionActivatedGoogleField(
                                  platform.key,
                                  field
                                ) && (
                                  <small style={{ color: "#6b7280", fontWeight: 500 }}>
                                    Tracking is disabled. You may select the asset now and enable tracking when ready.
                                  </small>
                                )}

                              {isEnabled && isLocked && (
                                <small style={{ color: "#6b7280", fontWeight: 500 }}>
                                  Locked after selection. Disconnect and reconnect {platform.name} to change it.
                                </small>
                              )}
                              </label>
                            )}

                            {platform.key === "google" && field === "GA4 Property" && (
                              <>
                              {ga4AssetMessage && (
                                <small style={{ color: "#92400e", lineHeight: 1.5 }}>
                                  {ga4AssetMessage}
                                </small>
                              )}
                              <button
                                hidden={!selectedValue}
                                type="button"
                                style={isEnabled && selectedValue ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!isEnabled || !selectedValue}
                                onClick={() => setActiveModal("ga4")}
                              >
                                Configuration
                              </button>
                              </>
                            )}

                            {platform.key === "google" &&
                              field ===
                                "Google Ads Account / Manager Account" &&
                              connection &&
                              shouldLoadGoogleAssets &&
                              googleAdsAssetMessage ? (
                                <div
                                  style={{
                                    marginTop: 6,
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    border:
                                      "1px solid #fbbf24",
                                    background:
                                      "#fffbeb",
                                    color: "#92400e",
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  {googleAdsAssetMessage}
                                </div>
                              ) : null}

                            {platform.key === "google" && field === "Google Ads Account / Manager Account" && (
                              <button
                                hidden={!selectedValue}
                                type="button"
                                style={isEnabled && selectedValue ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!isEnabled || !selectedValue}
                                onClick={() => {
                                  resetGoogleConversionForm();
                                  setActiveModal("conversions");
                                }}
                              >
                                Conversions
                              </button>
                            )}

                            {platform.key === "google" && field === "Google Merchant Center" && (
                              <button
                                hidden={!selectedValue}
                                type="button"
                                style={isEnabled && selectedValue ? styles.inlineActionButton : styles.disabledButton}
                                disabled={!isEnabled || !selectedValue}
                                onClick={() => setActiveModal("feed")}
                              >
                                Create Feed
                              </button>
                            )}
                            {platform.key === "google" &&
                              field === "Google Ads Remarketing" &&
                                isEnabled && (
                                <button
                                  type="button"
                                  style={
                                    isEnabled
                                      ? styles.inlineActionButton
                                      : styles.disabledButton
                                  }
                                  disabled={!isEnabled}
                                  onClick={() =>
                                    setActiveModal("remarketing")
                                  }
                                >
                                  Configuration
                                </button>
                              )}
                          </div>
                        );
                      })}

                            {platform.key === "google" && (
                              <div
                                style={{
                                  gridColumn: "1 / -1",
                                  padding: "10px 12px",
                                  borderTop: "1px solid #d1fae5",
                                  color: "#4b5563",
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                }}
                              >
                                <strong>Client Side:</strong> Events are sent from the customer’s browser or Shopify Customer Events pixel.
                                <br />
                                <strong>Server Side:</strong> Events are collected by the app and sent from the backend/server to the selected platform.
                              </div>
                            )}

                            {platform.key === "meta" && (
                              <div
                                style={{
                                  gridColumn: "1 / -1",
                                  display: "grid",
                                  gap: 10,
                                  padding: "12px",
                                  borderTop: "1px solid #d1fae5",
                                  color: "#4b5563",
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                }}
                              >
                                <div
                                  style={{
                                    padding: "10px 12px",
                                    border: "1px solid #fde68a",
                                    borderRadius: 10,
                                    background: "#fffbeb",
                                    color: "#92400e",
                                    fontWeight: 700,
                                  }}
                                >
                                  Meta Catalog setup is disabled for now because Meta rejected the catalog_management OAuth permission. Enable or approve catalog_management in Meta Developer settings before catalog creation and catalog sync.
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 10,
                                  }}
                                >
                                  <div>
                                    <strong>Client-side Pixel:</strong> {metaClientSideEnabled ? "Enabled" : "Disabled"} until Dataset / Pixel events are configured.
                                  </div>
                                  <div>
                                    <strong>Server-side CAPI:</strong> {metaServerSideEnabled ? "Enabled" : "Disabled"} until CAPI setup is added in Phase 2.
                                  </div>
                                  <div>
                                    <strong>Selected Events:</strong> {metaSelectedEvents.length}
                                  </div>
                                  <div>
                                    <strong>Catalog Status:</strong> Permission required
                                  </div>
                                </div>
                              </div>
                            )}
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
            <span>Client-side Tracking</span>
            <strong>{clientSideStatus}</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Server-side Tracking</span>
            <strong>{serverSideStatus}</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Remarketing</span>
            <strong>{googleRemarketingValue === "enabled" ? "Active" : "Disabled"}</strong>
          </div>
        </div>
      </section>


      {activeModal === "metaDataset" && (
        <Modal title="Meta Dataset / Pixel Configuration" onClose={() => setActiveModal(null)}>
          <div style={styles.modalGrid}>
            <p style={{ color: "#4b5563", lineHeight: 1.6 }}>
              Select the Meta Dataset / Pixel and choose which events DH Conversions should prepare for Meta tracking.
              Client-side Pixel and Server-side CAPI are saved separately.
            </p>

            <label style={styles.label}>
              <FieldLabel
                text="Dataset / Pixel"
                info={FIELD_HELP["Dataset / Pixel"]}
              />
              <select
                style={
                  metaDatasetLocked
                    ? {
                        ...styles.select,
                        backgroundColor: "#f3f4f6",
                        color: "#6b7280",
                        cursor: "not-allowed",
                      }
                    : styles.select
                }
                value={metaDatasetValue}
                disabled={metaDatasetLocked}
                title={
                  metaDatasetLocked
                    ? "Disconnect and reconnect Meta to change the Dataset / Pixel."
                    : undefined
                }
                onChange={(event) => {
                  const nextDatasetId = event.currentTarget.value;

                  setSelectedAssets((previous) => ({
                    ...previous,
                    [metaDatasetKey]: nextDatasetId,
                  }));
                }}
              >
                <option value="">Select Dataset / Pixel</option>
                {metaDatasetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Meta Test Event Code"
                info={FIELD_HELP["Meta Test Event Code"]}
              />
              <input
                style={styles.input}
                value={metaTestEventCode}
                placeholder="Optional test code from Meta Events Manager"
                onChange={(event) => {
                  const nextCode =
                    event.currentTarget.value;

                  setSelectedAssets(
                    (previous) => ({
                      ...previous,

                      ["meta:Meta Test Event Code"]:
                        nextCode,
                    })
                  );
                }}
              />

              <small
                style={{
                  color: "#6b7280",
                  fontWeight: 500,
                }}
              >
                {metaTestEventCode
                  ? "The saved Test Event Code is shown above. Edit it or clear it and click Save to remove it."
                  : "Optional. Add a code from Meta Events Manager when testing supported CAPI events."}
              </small>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Meta CAPI Access Token"
                info={FIELD_HELP["Meta CAPI Access Token"]}
              />
              <input
                style={styles.input}

                /*
                 * Display saved MASKED preview as normal text.
                 * A newly entered replacement token is hidden.
                 */
                type={
                  savedMetaCapiAccessTokenPreview &&
                  metaCapiAccessTokenInput ===
                    savedMetaCapiAccessTokenPreview
                    ? "text"
                    : "password"
                }

                value={
                  metaCapiAccessTokenInput
                }

                autoComplete="off"
                spellCheck={false}

                placeholder="Paste Meta CAPI access token"

                onChange={(event) => {
                  const nextToken =
                    event.currentTarget.value;

                  setMetaCapiAccessTokenInput(
                    nextToken
                  );

                  /*
                   * Removing the token also disables
                   * Server-side Meta CAPI.
                   */
                  if (
                    !nextToken.trim()
                  ) {
                    setSelectedAssets(
                      (previous) => ({
                        ...previous,

                        ["meta:Meta Server Side Enabled"]:
                          "false",
                      })
                    );
                  }
                }}
              />

              <small
                style={{
                  color:
                    metaCapiAccessTokenInput ===
                      savedMetaCapiAccessTokenPreview &&
                    savedMetaCapiAccessTokenPreview
                      ? "#166534"
                      : !metaCapiAccessTokenInput
                        ? "#b45309"
                        : "#6b7280",

                  fontWeight: 600,
                }}
              >
                {savedMetaCapiAccessTokenPreview &&
                metaCapiAccessTokenInput ===
                  savedMetaCapiAccessTokenPreview
                  ? "Saved token preview. The first and last 6 characters are shown; the middle is hidden."
                  : !metaCapiAccessTokenInput
                    ? savedMetaCapiAccessTokenPreview
                      ? "Token will be removed when you click Save. Server-side Meta CAPI will also be disabled."
                      : "No CAPI Access Token is saved."
                    : savedMetaCapiAccessTokenPreview
                      ? "A new token has been entered. Click Save to replace the current token."
                      : "Click Save to store this token securely."}
              </small>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Content ID / Product ID Format"
                info={FIELD_HELP["Content ID / Product ID Format"]}
              />
              <select
                style={styles.select}
                value={metaContentIdFormat}
                onChange={(event) => {
                  const nextFormat = event.currentTarget.value;

                  setSelectedAssets((previous) => ({
                    ...previous,
                    ["meta:Meta Content ID Format"]: nextFormat,
                  }));
                }}
              >
                {itemIdFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                Use the same format for Meta Pixel, CAPI, and future catalog item IDs.
              </small>
            </label>

            <div style={{ display: "grid", gap: 10 }}>
              <FieldLabel text="Delivery Options" info={FIELD_HELP["Meta Delivery Options"]} />

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={metaClientSideEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;

                    setSelectedAssets((previous) => ({
                      ...previous,
                      ["meta:Meta Client Side Enabled"]: checked ? "true" : "false",
                    }));
                  }}
                />
                Client-side Meta Pixel
              </label>

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={metaServerSideEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;

                    setSelectedAssets((previous) => ({
                      ...previous,
                      ["meta:Meta Server Side Enabled"]: checked ? "true" : "false",
                    }));
                  }}
                />
                Server-side Meta CAPI
              </label>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <FieldLabel text="Meta Events" info={FIELD_HELP["Meta Events"]} />
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                Choose the Meta events this Dataset / Pixel should receive. Saved event selections are shown below.
              </small>

              <div style={styles.checkGrid}>
                {metaEventOptions.map((eventOption) => {
                  const checked = metaSelectedEvents.includes(eventOption.value);

                  return (
                    <label key={eventOption.value} style={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextEvents = event.currentTarget.checked
                            ? Array.from(new Set([...metaSelectedEvents, eventOption.value]))
                            : metaSelectedEvents.filter((value) => value !== eventOption.value);

                          setSelectedAssets((previous) => ({
                            ...previous,
                            [metaEventsKey]: nextEvents.length ? nextEvents.join(",") : "none",
                          }));
                        }}
                      />
                      {eventOption.label}
                    </label>
                  );
                })}
              </div>

              {metaSelectedEvents.length === 0 && (
                <small style={{ color: "#b45309", fontWeight: 700 }}>
                  No Meta events selected yet.
                </small>
              )}
            </div>

            {(metaDatasetResult?.ok ||
              metaDatasetResult?.saved) &&
              !metaDatasetIsDirty && (
              <div
                style={
                  metaDatasetResult?.syncFailed
                    ? {
                        padding: "12px",
                        border: "1px solid #fde68a",
                        borderRadius: 10,
                        background: "#fffbeb",
                        color: "#92400e",
                        fontWeight: 700,
                        lineHeight: 1.5,
                      }
                    : styles.successBox
                }
              >
                {metaDatasetResult?.syncFailed
                  ? metaDatasetResult.warning ||
                    "Meta settings were saved, but Web Pixel synchronization needs attention."
                  : metaDatasetResult.message ||
                    "Meta Dataset / Pixel settings saved successfully."}
              </div>
            )}

            {metaDatasetResult?.error &&
            !metaDatasetResult?.saved ? (
              <div style={styles.errorBox}>
                {metaDatasetResult.error}
              </div>
            ) : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() =>
                  setActiveModal(null)
                }
              >
                Cancel
              </button>

              <button
                type="button"

                style={
                  metaDatasetValue &&
                  metaDatasetFetcher.state ===
                    "idle"
                    ? styles.primaryButton
                    : styles.disabledButton
                }

                disabled={
                  !metaDatasetValue ||
                  metaDatasetFetcher.state !==
                    "idle"
                }

                onClick={() => {
                  /*
                   * Nothing changed:
                   * primary action becomes Close.
                   */
                  if (
                    metaDatasetHasSavedConfig &&
                    !metaDatasetIsDirty
                  ) {
                    setActiveModal(null);
                    return;
                  }

                  const selectedOption =
                    metaDatasetOptions.find(
                      (option) =>
                        option.value ===
                        metaDatasetValue
                    );

                  const capiAccessTokenMode =
                    !metaCapiAccessTokenInput.trim()
                      ? "remove"
                      : (
                          savedMetaCapiAccessTokenPreview &&
                          metaCapiAccessTokenInput ===
                            savedMetaCapiAccessTokenPreview
                        )
                        ? "keep"
                        : "replace";

                  metaDatasetFetcher.submit(
                    {
                      _action:
                        "save_meta_dataset_settings",

                      datasetId:
                        metaDatasetValue,

                      datasetName:
                        selectedOption?.label ||
                        metaDatasetValue,

                      selectedEvents:
                        metaSelectedEvents.length
                          ? metaSelectedEvents.join(
                              ","
                            )
                          : "none",

                      clientSideEnabled:
                        metaClientSideEnabled
                          ? "true"
                          : "false",

                      serverSideEnabled:
                        metaServerSideEnabled
                          ? "true"
                          : "false",

                      testEventCode:
                        metaTestEventCode,

                      contentIdFormat:
                        metaContentIdFormat,

                      capiAccessToken:
                        metaCapiAccessTokenInput,

                      capiAccessTokenMode,
                    },
                    {
                      method:
                        "post",
                    }
                  );
                }}
              >
                {metaDatasetFetcher.state !==
                "idle"
                  ? "Saving..."
                  : !metaDatasetValue
                    ? "Select Dataset / Pixel First"
                    : metaDatasetHasSavedConfig &&
                        !metaDatasetIsDirty
                      ? "Close"
                      : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === "metaBusiness" && (
        <Modal title="Meta Business Portfolio" onClose={() => setActiveModal(null)}>
          <div style={styles.modalGrid}>
            <p style={{ color: "#4b5563", lineHeight: 1.6 }}>
              Select the Meta Business Portfolio that owns the Dataset / Pixel for this shop. If you do not see all portfolios, reconnect Meta and allow access to all current and future Businesses.
              Found {metaBusinessOptions.length} Business Portfolio{metaBusinessOptions.length === 1 ? "" : "s"}.
            </p>

            {metaBusinessOptions.length === 0 ? (
              <div
                style={{
                  padding: "12px",
                  border: "1px solid #fde68a",
                  borderRadius: 10,
                  background: "#fffbeb",
                  color: "#92400e",
                  fontWeight: 700,
                }}
              >
                No Business Portfolios loaded. Reconnect Meta with a user that has access to a Meta Business Portfolio, then reopen this page from Shopify Admin.
              </div>
            ) : (
              <label style={styles.label}>
                <FieldLabel
                  text="Business Portfolio"
                  info={FIELD_HELP["Meta Business Portfolio"]}
                />
                <select
                  style={
                    metaBusinessLocked
                      ? {
                          ...styles.select,
                          backgroundColor: "#f3f4f6",
                          color: "#6b7280",
                          cursor: "not-allowed",
                        }
                      : styles.select
                  }
                  value={metaBusinessValue}
                  disabled={metaBusinessLocked}
                  title={
                    metaBusinessLocked
                      ? "Disconnect and reconnect Meta to change the Business Portfolio."
                      : undefined
                  }
                  onChange={(event) => {
                    const nextBusinessId = event.currentTarget.value;

                    setSelectedAssets((previous) => ({
                      ...previous,
                      [metaBusinessKey]: nextBusinessId,
                    }));

                    /*
                     * The newly selected Portfolio is only a
                     * local draft until the server confirms it.
                     */
                    setMetaBusinessDrafting(true);
                  }}
                >
                  <option value="">Select Business Portfolio</option>
                  {metaBusinessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {metaBusinessConfirmed ? (
              <div style={styles.successBox}>
                Meta Business Portfolio connected
                successfully.
              </div>
            ) : null}

            {metaBusinessResult?.warning ? (
              <div
                style={{
                  padding: "12px",
                  border: "1px solid #fde68a",
                  borderRadius: 10,
                  background: "#fffbeb",
                  color: "#92400e",
                  fontWeight: 700,
                  lineHeight: 1.5,
                }}
              >
                {metaBusinessResult.warning}
              </div>
            ) : null}

            {metaBusinessResult?.error &&
            !metaBusinessResult?.saved ? (
              <div style={styles.errorBox}>
                {metaBusinessResult.error}
              </div>
            ) : null}

            <div style={styles.modalActions}>
              {!metaBusinessConfirmed ? (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    setMetaBusinessDrafting(false);
                    setActiveModal(null);

                    /*
                     * Discard any unsaved local Portfolio
                     * selection by loading server state again.
                     */
                    revalidator.revalidate();
                  }}
                >
                  Cancel
                </button>
              ) : null}

              <button
                type="button"
                style={
                  metaBusinessConfirmed ||
                  (
                    metaBusinessValue &&
                    metaBusinessFetcher.state ===
                      "idle"
                  )
                    ? styles.primaryButton
                    : styles.disabledButton
                }
                disabled={
                  !metaBusinessConfirmed &&
                  (
                    !metaBusinessValue ||
                    metaBusinessFetcher.state !==
                      "idle"
                  )
                }
                onClick={() => {
                  /*
                   * A confirmed Portfolio uses Close.
                   * Refresh Meta assets only after successful
                   * persistence, never after a fixed timeout.
                   */
                  if (metaBusinessConfirmed) {
                    window.location.href =
                      withNav(
                        "/app/settings?loadMetaAssets=true"
                      );

                    return;
                  }

                  const selectedOption =
                    metaBusinessOptions.find(
                      (option) =>
                        option.value ===
                        metaBusinessValue
                    );

                  setMetaBusinessDrafting(false);

                  metaBusinessFetcher.submit(
                    {
                      _action:
                        "save_asset_selection",

                      platform:
                        "meta",

                      assetType:
                        "Meta Business Portfolio",

                      assetValue:
                        metaBusinessValue,

                      assetLabel:
                        selectedOption?.label ||
                        metaBusinessValue,
                    },
                    {
                      method:
                        "post",
                    }
                  );
                }}
              >
                {metaBusinessConfirmed
                  ? "Close"
                  : metaBusinessFetcher.state !==
                      "idle"
                    ? "Saving..."
                    : "Save Business Portfolio"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === "remarketing" && (
        <Modal title="Google Ads Remarketing Configuration" onClose={() => setActiveModal(null)}>
          <div style={styles.modalGrid}>
            <label style={styles.label}>
              <FieldLabel
                text="Item ID Format"
                info={FIELD_HELP["Remarketing Item ID Format"]}
              />
              <select
                style={styles.select}
                value={getItemIdFormat("google", "Google Ads Remarketing")}
                onChange={(event) =>
                  saveItemIdFormat("google", "Google Ads Remarketing", event.currentTarget.value)
                }
              >
                {itemIdFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                For best product matching, use the same item ID format as your Merchant Center feed.
              </small>
            </label>

            <div style={{ display: "grid", gap: 10 }}>
              <FieldLabel text="Remarketing Events" info={FIELD_HELP["Remarketing Events"]} />

              <div style={styles.checkGrid}>
                {remarketingEventOptions.map((eventOption) => {
                  const checked = getSelectedCsvSetting("google:Google Ads Remarketing:events").includes(
                    eventOption.value
                  );

                  return (
                    <label key={eventOption.value} style={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          updateCsvSetting(
                            "google",
                            "Google Ads Remarketing:events",
                            eventOption.value,
                            event.currentTarget.checked
                          )
                        }
                      />
                      {eventOption.label}
                    </label>
                  );
                })}
              </div>

              {getSelectedCsvSetting("google:Google Ads Remarketing:events").length === 0 && (
                <small style={{ color: "#b45309", fontWeight: 700 }}>
                  Select at least one remarketing event.
                </small>
              )}
            </div>

            <p style={{ color: "#6b7280", lineHeight: 1.6 }}>
              Remarketing events are sent client-side from the Shopify Customer Events pixel.
              Use the same item ID format as your Merchant Center product feed.
            </p>

            <div style={styles.modalActions}>
              <button type="button" style={styles.primaryButton} onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === "ga4" && (
        <Modal title="GA4 Configuration" onClose={() => setActiveModal(null)}>
          <ga4DeliveryFetcher.Form method="post" style={styles.modalGrid}>
            <input type="hidden" name="_action" value="save_ga4_delivery_settings" />
            <input type="hidden" name="propertyId" value={ga4PropertyValue} />

            <label style={styles.label}>
              <FieldLabel
                text="Selected GA4 Property"
                info={FIELD_HELP["Selected GA4 Property"]}
              />
              <input
                style={styles.input}
                value={ga4PropertyValue || "Select GA4 Property first"}
                readOnly
              />
            </label>

            {assets.google.ga4DataStreams.length > 0 ? (
              <label style={styles.label}>
                <FieldLabel
                  text="GA4 Data Stream / Measurement ID"
                  info={FIELD_HELP["GA4 Data Stream / Measurement ID"]}
                />
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
                <FieldLabel
                  text="GA4 Measurement ID"
                  info={FIELD_HELP["GA4 Measurement ID"]}
                />
                <input
                  style={styles.input}
                  name="measurementId"
                  placeholder="Example: G-XXXXXXXXXX"
                  defaultValue={ga4DeliverySettings?.credential?.assetId || ""}
                />
              </label>
            )}

            <label style={styles.label}>
              <FieldLabel
                text="Delivery Mode"
                info={FIELD_HELP["GA4 Delivery Mode"]}
              />
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
                <span
                  style={{
                    color: getGa4ApiSecretTitleColor(ga4ApiSecretConfigured),
                  }}
                >
                  <FieldLabel
                    text={`GA4 API Secret${
                      ga4ApiSecretConfigured
                        ? " · Saved"
                        : ""
                    }`}
                    info={FIELD_HELP["GA4 API Secret"]}
                  />
                </span>
                <input
                  style={styles.input}
                  name="apiSecret"
                  type="password"
                  placeholder={
                    ga4ApiSecretConfigured
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

            <label style={styles.label}>
              <FieldLabel
                text="GA4 Item ID Format"
                info={FIELD_HELP["GA4 Item ID Format"]}
              />
              <select
                style={styles.select}
                value={getItemIdFormat("google", "GA4 Property")}
                onChange={(event) =>
                  saveItemIdFormat("google", "GA4 Property", event.currentTarget.value)
                }
              >
                {itemIdFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                For best product matching, use the same item ID format as your Merchant Center feed.
              </small>
            </label>

            <div style={{ display: "grid", gap: 10 }}>
              <FieldLabel text="GA4 Events to Send" info={FIELD_HELP["GA4 Events to Send"]} />

              <div style={styles.checkGrid}>
                {ga4EventOptions.map((eventOption) => {
                  const checked = getSelectedCsvSetting("google:GA4 Property:events").includes(
                    eventOption.value
                  );

                  return (
                    <label key={eventOption.value} style={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          updateCsvSetting(
                            "google",
                            "GA4 Property:events",
                            eventOption.value,
                            event.currentTarget.checked
                          )
                        }
                      />
                      {eventOption.label}
                    </label>
                  );
                })}
              </div>

              {getSelectedCsvSetting("google:GA4 Property:events").length === 0 && (
                <small style={{ color: "#b45309", fontWeight: 700 }}>
                  Select at least one GA4 event.
                </small>
              )}
            </div>

            <p style={{ color: "#6b7280", lineHeight: 1.6 }}>
              Client Side sends events from the browser/customer pixel.
              Server Side sends selected events from the app backend using the selected GA4 configuration.
            </p>

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => {
                  resetGoogleConversionForm();
                  setActiveModal(null);
                }}
              >
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
            <input type="hidden" name="setupType" value="custom" />
            <input type="hidden" name="conversionActionRecordId" value={googleConversionForm.recordId} />
            <input
              type="hidden"
              name="googleAdsLoginCustomerId"
              value={googleAdsLoginCustomerId}
            />

            <label style={styles.label}>
              <FieldLabel
                text="Selected Google Ads Account"
                info={FIELD_HELP["Selected Google Ads Account"]}
              />
              <input
                style={styles.input}
                name="googleAdsCustomerId"
                value={googleAdsAccountValue}
                readOnly
              />
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Conversion Event"
                info={FIELD_HELP["Conversion Event"]}
              />
              <select
                style={styles.select}
                name="eventName"
                value={googleConversionForm.eventName}
                onChange={(event) => updateGoogleConversionForm("eventName", event.currentTarget.value)}
              >
                <option value="">Select event</option>
                <option value="PAGE_VIEW">Page View</option>
                <option value="VIEW_ITEM">View Item</option>
                <option value="ADD_TO_CART">Add to Cart</option>
                <option value="BEGIN_CHECKOUT">Begin Checkout</option>
                <option value="ADD_SHIPPING_INFO">Add Shipping Info</option>
                <option value="ADD_PAYMENT_INFO">Add Payment Info</option>
                <option value="PURCHASE">Purchase</option>
                <option value="LEAD">Lead</option>
                <option value="SUBSCRIBE">Subscribe</option>
              </select>
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                Select the Shopify event for this Google Ads conversion. You can create multiple conversions for the same event by using different custom names.
              </small>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Conversion Name"
                info={FIELD_HELP["Conversion Name"]}
              />
              <input
                style={styles.input}
                name="conversionName"
                placeholder="Optional custom name"
                value={googleConversionForm.conversionName}
                onChange={(event) => updateGoogleConversionForm("conversionName", event.currentTarget.value)}
              />
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                Enter a custom name to use it exactly in Google Ads. Leave blank to use the default name for the selected event, such as DH - Page View or DH - Purchase.
              </small>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Goal Role"
                info={FIELD_HELP["Goal Role"]}
              />
              <select
                style={styles.select}
                name="isPrimary"
                value={googleConversionForm.isPrimary}
                onChange={(event) => updateGoogleConversionForm("isPrimary", event.currentTarget.value)}
              >
                <option value="true">Primary conversion</option>
                <option value="false">Secondary conversion</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Conversion Value"
                info={FIELD_HELP["Conversion Value"]}
              />
              <select
                style={styles.select}
                name="conversionValueMode"
                value={googleConversionForm.conversionValueMode}
                onChange={(event) => updateGoogleConversionForm("conversionValueMode", event.currentTarget.value)}
              >
                <option value="dynamic">Use dynamic Shopify value</option>
                <option value="fixed">Use fixed value</option>
                <option value="none">No value</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Google Ads Item ID Format"
                info={FIELD_HELP["Google Ads Item ID Format"]}
              />
              <select
                style={styles.select}
                value={getItemIdFormat("google", "Google Ads Account / Manager Account")}
                onChange={(event) =>
                  saveItemIdFormat(
                    "google",
                    "Google Ads Account / Manager Account",
                    event.currentTarget.value
                  )
                }
              >
                {itemIdFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small style={{ color: "#6b7280", fontWeight: 500 }}>
                For best product matching, use the same item ID format as your Merchant Center feed.
              </small>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Google Ads Delivery Mode"
                info={FIELD_HELP["Google Ads Delivery Mode"]}
              />
              <select
                style={styles.select}
                name="deliveryMode"
                value={
                  googleConversionForm.eventName !==
                    "PURCHASE" &&
                  googleConversionForm.deliveryMode ===
                    "server"
                    ? "client"
                    : googleConversionForm.deliveryMode
                }
                onChange={(event) =>
                  updateGoogleConversionForm(
                    "deliveryMode",
                    event.currentTarget.value
                  )
                }
              >
                <option value="client">
                  Client-side only
                </option>
                <option
                  value="server"
                  disabled={
                    googleConversionForm.eventName !==
                    "PURCHASE"
                  }
                >
                  Server-side only — Purchase
                </option>
              </select>

              {googleConversionForm.eventName &&
                googleConversionForm.eventName !==
                  "PURCHASE" && (
                  <small
                    style={{
                      color: "#6b7280",
                      fontWeight: 500,
                    }}
                  >
                    Server-side Google Ads delivery currently
                    supports Purchase only. Other conversion
                    events use client-side delivery.
                  </small>
                )}
            </label>

            {googleConversionForm.recordId && (
              <div style={styles.notice}>
                Editing existing conversion mapping. Save will update this app record.
              </div>
            )}

            {conversionResult?.ok && (
              <div style={styles.successBox}>
                {conversionResult.message || "Conversion configuration saved."}
              </div>
            )}

            {conversionResult?.error && (
              <div style={styles.errorBox}>
                <div>{conversionResult.error}</div>

                {conversionResult.details ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    Google API details:{" "}
                    {conversionResult.details}
                  </div>
                ) : null}
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
                  ? googleConversionForm.recordId
                    ? "Update Conversion"
                    : "Create Conversion"
                  : "Saving..."}
              </button>
            </div>
          </conversionFetcher.Form>

          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "16px" }}>
              Created Google Ads Conversions
            </h3>

            {deleteConversionResult?.ok && (
              <div style={styles.successBox}>
                {deleteConversionResult.message || "Conversion removed."}
              </div>
            )}

            {deleteConversionResult?.error && (
              <div style={styles.errorBox}>
                {deleteConversionResult.error}
              </div>
            )}

            {!googleAdsConversionActions?.length && (
              <p style={{ margin: 0, color: "#6b7280", fontSize: "13px" }}>
                No active Google Ads conversions found for the selected account.
              </p>
            )}

            {Boolean(googleAdsConversionActions?.length) && (
              <div style={{ display: "grid", gap: "8px" }}>
                {googleAdsConversionActions.map(
                  (
                    conversion:
                      (typeof googleAdsConversionActions)[number]
                  ) => (
                  <div
                    key={conversion.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1.2fr 0.8fr 0.8fr 1.2fr auto auto",
                      gap: "8px",
                      alignItems: "center",
                      padding: "10px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      fontSize: "12px",
                    }}
                  >
                    <div>
                      <strong>{conversion.eventName}</strong>
                      <div style={{ color: "#6b7280" }}>{conversion.deliveryMode}</div>
                    </div>

                    <div>{conversion.conversionName || "-"}</div>

                    <div>
                      {conversion.isPrimary ? "Primary" : "Secondary"}
                    </div>

                    <div>{conversion.conversionId || "-"}</div>

                    <div
                      title={conversion.conversionLabel || ""}
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {conversion.conversionLabel || "-"}
                    </div>

                    <button
                      type="button"
                      style={{
                        ...styles.secondaryButton,
                        padding: "8px 10px",
                      }}
                      onClick={() => editGoogleConversion(conversion)}
                    >
                      Modify
                    </button>

                    <deleteConversionFetcher.Form method="post">
                      <input type="hidden" name="_action" value="delete_google_conversion" />
                      <input type="hidden" name="conversionActionRecordId" value={conversion.id} />
                      <button
                        type="submit"
                        style={{
                          ...styles.secondaryButton,
                          padding: "8px 10px",
                          borderColor: "#fecaca",
                          color: "#b91c1c",
                        }}
                        disabled={deleteConversionFetcher.state !== "idle"}
                      >
                        Delete
                      </button>
                    </deleteConversionFetcher.Form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

            {activeModal === "feed" && (
        <Modal title="Merchant Center Feed Configuration" onClose={() => setActiveModal(null)}>
          <feedFetcher.Form method="post" style={{ maxWidth: "760px", overflowX: "hidden" }}>
            <input type="hidden" name="_action" value="create_merchant_feed" />
            <input type="hidden" name="merchantId" value={merchantCenterValue} />
            <input type="hidden" name="contentLanguage" value="en" />
            <input type="hidden" name="limit" value="10" />
            <input type="hidden" name="uploadRunId" value={String(Date.now())} />

            <label style={styles.label}>
              <FieldLabel
                text="Selected Merchant Center"
                info={FIELD_HELP["Selected Merchant Center"]}
              />
              <input
                style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}
                value={merchantCenterValue}
                readOnly
              />
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Target Country"
                info={FIELD_HELP["Target Country"]}
              />

              <select
                name="targetCountry"
                value={feedTargetCountry}
                onChange={(event) => {
                  const nextCountry =
                    event.currentTarget.value;

                  setFeedTargetCountry(nextCountry);

                  if (nextCountry !== "CUSTOM") {
                    setFeedCustomTargetCountry("");
                  }
                }}
                style={{
                  ...styles.input,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                {merchantCountryOptions.map(
                  (country) => (
                    <option
                      key={country.code}
                      value={country.code}
                    >
                      {country.name} - {country.code}
                    </option>
                  )
                )}

                <option value="CUSTOM">
                  Custom country code
                </option>
              </select>
            </label>

            {feedTargetCountry === "CUSTOM" ? (
              <label style={styles.label}>
                <FieldLabel
                  text="Custom Target Country Code"
                  info={
                    FIELD_HELP[
                      "Custom Target Country Code"
                    ]
                  }
                />

                <input
                  name="customTargetCountry"
                  value={feedCustomTargetCountry}
                  onChange={(event) =>
                    setFeedCustomTargetCountry(
                      event.currentTarget.value
                        .replace(/[^A-Za-z]/g, "")
                        .slice(0, 2)
                        .toUpperCase()
                    )
                  }
                  required
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  placeholder="Example: ZZ"
                  style={{
                    ...styles.input,
                    width: "100%",
                    boxSizing: "border-box",
                    textTransform: "uppercase",
                  }}
                />
              </label>
            ) : null}

            <label style={styles.label}>
              <FieldLabel
                text="Product ID Format"
                info={FIELD_HELP["Product ID Format"]}
              />
              <select
                name="productIdFormat"
                defaultValue="shopify_country_product_variant"
                style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}
              >
                <option value="shopify_country_product_variant">Shopify_US_productID_variantID</option>
                <option value="product_variant">productID_variantID</option>
                <option value="product_id">productid</option>
                <option value="variant_id">variantID</option>
                <option value="sku">SKU</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Product Channel"
                info={FIELD_HELP["Product Channel"]}
              />
              <select name="channel" defaultValue="online" style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}>
                <option value="online">Online products</option>
                <option value="local">Local products later / advanced</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Marketing Methods"
                info={FIELD_HELP["Marketing Methods"]}
              />
              <select name="marketingMethod" defaultValue="all" style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}>
                <option value="all">Free listings and Shopping ads</option>
                <option value="free_listings">Free listings only</option>
                <option value="shopping_ads">Shopping ads only</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Feed Update Schedule"
                info={FIELD_HELP["Feed Update Schedule"]}
              />
              <select name="scheduleInterval" defaultValue="manual" style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}>
                <option value="manual">Manual upload only</option>
                <option value="hourly">Hourly</option>
                <option value="every_3_hours">Every 3 hours</option>
                <option value="every_6_hours">Every 6 hours</option>
                <option value="every_9_hours">Every 9 hours</option>
                <option value="daily">Daily</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Feed Creation Method"
                info={FIELD_HELP["Feed Creation Method"]}
              />
              <select style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}>
                <option value="all">All active in-stock Shopify products</option>
                <option value="category">Create feed by category/collection later</option>
                <option value="selected">Create feed from selected products later</option>
              </select>
            </label>

            <label style={styles.label}>
              <FieldLabel
                text="Category / Collection"
                info={FIELD_HELP["Category / Collection"]}
              />
              <select style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}>
                <option>Select category or collection</option>
                <option>Collection loading API pending</option>
              </select>
            </label>

            <div style={{ ...styles.checkboxGrid, width: "100%", boxSizing: "border-box" }}>
              <label><input type="checkbox" defaultChecked /> Sync title</label>
              <label><input type="checkbox" defaultChecked /> Sync description</label>
              <label><input type="checkbox" defaultChecked /> Sync images</label>
              <label><input type="checkbox" defaultChecked /> Sync variants</label>
              <label><input type="checkbox" defaultChecked /> Sync price</label>
              <label><input type="checkbox" defaultChecked /> Sync inventory</label>
              <label><input type="checkbox" defaultChecked /> Sync category</label>
            </div>

            <div style={{ marginTop: 12, padding: 12, border: "1px solid #fde68a", borderRadius: 10, background: "#fffbeb" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 700 }}>
                <input name="includeRestrictedProducts" type="checkbox" value="true" />
                <FieldLabel
                  text="Include restricted/adult products if detected"
                  info={FIELD_HELP["Restricted Products"]}
                />
              </label>
              <p style={{ margin: "6px 0 0", color: "#92400e", fontSize: 13 }}>
                Default: unchecked. Restricted/adult items are skipped unless this is checked.
              </p>
            </div>

            <div style={{ ...styles.modalActions, flexWrap: "wrap", gap: 10 }}>
              <button type="button" style={styles.secondaryButton} onClick={() => setActiveModal(null)}>
                Cancel
              </button>

              <button
                type="submit"
                style={styles.primaryButton}
                disabled={feedFetcher.state !== "idle" || !merchantCenterValue}
              >
                {feedFetcher.state === "idle" ? "Upload Feed to Merchant Center" : "Uploading Feed..."}
              </button>

              {feedResult?.message && (
                <div style={styles.successBox}>
                  {feedResult.message}
                </div>
              )}

              {feedResult?.error && (
                <div style={styles.errorBox}>
                  {feedResult.error}
                  {feedResult.details ? ` Details: ${feedResult.details}` : ""}
                </div>
              )}
            </div>
          </feedFetcher.Form>
        </Modal>
      )}

          <section
        style={{
          marginTop: 24,
          padding: 18,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#f9fafb",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Configuration tools</h3>

        <p style={{ color: "#4b5563", lineHeight: 1.6 }}>
          Review event delivery activity or open the configuration documentation.
          Connect or reconnect Google whenever its asset selections need to be changed.
        </p>

        <div className="dh-button-row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

          <button
            type="button"
            className="dh-button dh-button--active"
            onClick={() => navigate(withNav("/app/delivery-logs"))}
            style={{
              display: "inline-block",
              padding: "10px 16px",
              backgroundColor: "#111827",
              color: "white",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
            }}
          >
            Open Event Delivery Logs
          </button>

          <button
            type="button"
            className="dh-button"
            onClick={() => navigate(withNav("/app/help"))}
            style={{
              display: "inline-block",
              padding: "10px 16px",
              backgroundColor: "white",
              color: "#111827",
              border: "1px solid #d1d5db",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Help / Documentation
          </button>
        </div>
      </section>

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


function FieldLabel({
  text,
  info,
}: {
  text: string;
  info: string;
}) {
  return (
    <span style={styles.labelTitle}>
      <span>{text}</span>
      <InfoTip text={info} />
    </span>
  );
}

function InfoTip({
  text,
}: {
  text: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={styles.infoWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        style={styles.infoButton}
        aria-label="Field information"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        i
      </button>

      {open ? (
        <span
          role="tooltip"
          style={styles.infoTooltip}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

const styles: Record<string, CSSProperties> = {
  labelTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
    minWidth: 0,
  },

  infoWrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    zIndex: 25,
  },

  infoButton: {
    width: 15,
    height: 15,
    minWidth: 15,
    padding: 0,
    display: "inline-grid",
    placeItems: "center",
    boxSizing: "border-box",
    borderRadius: "50%",
    border: "1px solid #15803d",
    outline: "none",
    backgroundColor: "transparent",
    color: "#15803d",
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 400,
    fontStyle: "normal",
    fontFamily: "Arial, sans-serif",
    cursor: "help",
    position: "relative",
    top: -5,
  },

  infoTooltip: {
    position: "absolute",
    zIndex: 30000,
    left: 18,
    top: -10,
    width: "min(320px, calc(100vw - 80px))",
    maxWidth: 320,
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid #86efac",
    backgroundColor: "#052e16",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.55,
    boxShadow:
      "0 10px 30px rgba(15,23,42,.24)",
    whiteSpace: "normal",
    pointerEvents: "none",
  },

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
    gap: 7,
    display: "grid",
    color: "#374151",
    fontWeight: 700,
    fontSize: 14,
  },
  select: {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#111827",
  },
  input: {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#111827",
  },
  textarea: {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
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
  dangerButton: {
    background: "#b91c1c",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
  pixelStatusConnected: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
    fontSize: 13,
  },
  pixelStatusDisconnected: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fca5a5",
    fontSize: 13,
  },
  pixelWarningText: {
    margin: "12px 0 0",
    color: "#92400e",
    fontWeight: 600,
  },
  pixelSuccessText: {
    margin: "12px 0 0",
    color: "#166534",
    fontWeight: 600,
  },
  pixelErrorText: {
    margin: "12px 0 0",
    color: "#991b1b",
    fontWeight: 600,
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
  fieldWithAction: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    alignItems: "stretch",
    gap: 10,
    width: "100%",
    minWidth: 0,
  },
  connectedBadge: {
    display: "inline-block",
    width: "fit-content",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 700,
  },
  pendingBadge: {
    display: "inline-block",
    width: "fit-content",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 12,
    fontWeight: 700,
  },
  checkboxGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    background: "#f9fafb",
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
    boxSizing: "border-box",
    overflowX: "hidden",
    overflowY: "auto",
    width: "min(760px, 100%)",
    maxHeight: "90vh",
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
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    overflowX: "hidden",
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
