import db from "../db.server";

export const TEST_MODE_CHANNELS = [
  "ga4_client",
  "ga4_server",
  "google_ads_client",
  "google_ads_server",
  "meta_pixel",
  "meta_capi",
] as const;

export type TestModeChannel = typeof TEST_MODE_CHANNELS[number];
export type TestModeOverride = "GLOBAL" | "ENABLED" | "DISABLED";
export type TestModeSource =
  | "ENVIRONMENT_OVERRIDE"
  | "PLATFORM_OVERRIDE"
  | "GLOBAL_SELECTION"
  | "DEFAULT";

export type EffectiveTestMode = {
  enabled: boolean;
  source: TestModeSource;
  mechanism: string;
};

const MECHANISMS: Record<TestModeChannel, string> = {
  ga4_client: "GA4_DEBUG_MODE",
  ga4_server: "GA4_DEBUGVIEW",
  google_ads_client: "NORMAL_CLIENT_REQUEST",
  google_ads_server: "VALIDATE_ONLY",
  meta_pixel: "NORMAL_PIXEL_REQUEST",
  meta_capi: "META_TEST_EVENT_CODE",
};

export function resolveEffectiveTestMode(input: {
  channel: TestModeChannel;
  globalEnabled: boolean;
  globallySelected: boolean;
  override?: TestModeOverride | null;
  environmentOverride?: boolean | null;
  mechanism?: string;
}): EffectiveTestMode {
  const mechanism = input.mechanism || MECHANISMS[input.channel];
  if (typeof input.environmentOverride === "boolean") {
    return { enabled: input.environmentOverride, source: "ENVIRONMENT_OVERRIDE", mechanism };
  }
  if (input.override === "ENABLED") {
    return { enabled: true, source: "PLATFORM_OVERRIDE", mechanism };
  }
  if (input.override === "DISABLED") {
    return { enabled: false, source: "PLATFORM_OVERRIDE", mechanism };
  }
  if (input.globalEnabled && input.globallySelected) {
    return { enabled: true, source: "GLOBAL_SELECTION", mechanism };
  }
  return { enabled: false, source: "DEFAULT", mechanism: "PRODUCTION" };
}

function parseBoolean(value?: string | null) {
  return value === "true";
}

function parseEnvironmentOverride(channel: TestModeChannel): boolean | null {
  const key = `TEST_MODE_${channel.toUpperCase()}`;
  if (process.env[key] === "true") return true;
  if (process.env[key] === "false") return false;
  return null;
}

export async function getTestModeSettings(workspaceId: string) {
  const rows = await db.shopAssetSelection.findMany({
    where: { workspaceId, platform: "test_mode" },
    select: { assetType: true, assetValue: true },
  });
  const values = new Map<string, string>(rows.map((row: { assetType: string; assetValue: string }) => [row.assetType, row.assetValue]));
  // Read the legacy key so existing enabled shops do not silently change state.
  const legacy = await db.shopAssetSelection.findUnique({
    where: {
      workspaceId_platform_assetType: {
        workspaceId,
        platform: "app",
        assetType: "test_mode_enabled",
      },
    },
  });
  const enabled = parseBoolean(values.get("enabled") ?? legacy?.assetValue);
  const channels = Object.fromEntries(TEST_MODE_CHANNELS.map((channel) => {
    const selected = parseBoolean(values.get(`selected:${channel}`));
    const overrideValue = values.get(`override:${channel}`);
    const override: TestModeOverride = overrideValue === "ENABLED" || overrideValue === "DISABLED"
      ? overrideValue
      : "GLOBAL";
    return [channel, {
      selected,
      override,
      effective: resolveEffectiveTestMode({
        channel,
        globalEnabled: enabled,
        globallySelected: selected,
        override,
        environmentOverride: parseEnvironmentOverride(channel),
      }),
    }];
  }));
  return { enabled, value: enabled ? "true" : "false", label: enabled ? "TEST MODE ACTIVE" : "Live Mode", channels };
}

export async function saveTestModeSettings(data: {
  workspaceId: string;
  enabled: boolean;
  selectedChannels?: string[];
  overrides?: Partial<Record<TestModeChannel, TestModeOverride>>;
}) {
  const selected = new Set(data.selectedChannels || []);
  const entries = [
    { assetType: "enabled", assetValue: String(data.enabled), assetLabel: data.enabled ? "TEST MODE ACTIVE" : "Live Mode" },
    ...TEST_MODE_CHANNELS.flatMap((channel) => [
      { assetType: `selected:${channel}`, assetValue: String(selected.has(channel)), assetLabel: channel },
      { assetType: `override:${channel}`, assetValue: data.overrides?.[channel] || "GLOBAL", assetLabel: channel },
    ]),
  ];
  await db.$transaction(entries.map((entry) => db.shopAssetSelection.upsert({
    where: { workspaceId_platform_assetType: { workspaceId: data.workspaceId, platform: "test_mode", assetType: entry.assetType } },
    update: entry,
    create: { workspaceId: data.workspaceId, platform: "test_mode", ...entry },
  })));
  return getTestModeSettings(data.workspaceId);
}

export async function isTestModeEnabled(workspaceId?: string | null) {
  return workspaceId ? (await getTestModeSettings(workspaceId)).enabled : false;
}
