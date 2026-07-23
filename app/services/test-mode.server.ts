import { randomUUID } from "node:crypto";
import db from "../db.server";

export const TEST_MODE_CHANNELS = [
  "ga4_client",
  "ga4_server",
  "google_ads_client",
  "google_ads_server",
  "meta_pixel",
  "meta_capi",
] as const;

export type TestModeChannel =
  typeof TEST_MODE_CHANNELS[number];

export type TestModeOverride =
  | "GLOBAL"
  | "ENABLED"
  | "DISABLED";

export type TestModeSource =
  | "ENVIRONMENT_OVERRIDE"
  | "PLATFORM_OVERRIDE"
  | "GLOBAL_SELECTION"
  | "PLATFORM_SESSION"
  | "DEFAULT";

export type TestPlatform =
  | "ga4"
  | "meta";

export type EffectiveTestMode = {
  enabled: boolean;
  source: TestModeSource;
  mechanism: string;
  runId?: string | null;
  expiresAt?: string | null;
};

export type PlatformTestSession = {
  platform: TestPlatform;
  active: boolean;
  runId: string | null;
  expiresAt: string | null;
};

const STORAGE_PLATFORM =
  "platform_test_session";

const DEFAULT_DURATION_MINUTES = 30;

const MECHANISMS: Record<
  TestModeChannel,
  string
> = {
  ga4_client: "GA4_DEBUG_MODE",
  ga4_server: "GA4_DEBUGVIEW",
  google_ads_client: "TAG_ASSISTANT",
  google_ads_server: "VALIDATE_ONLY",
  meta_pixel: "META_BROWSER_TEST",
  meta_capi: "META_TEST_EVENT_CODE",
};

function text(value: unknown): string {
  return value === undefined ||
    value === null
    ? ""
    : String(value).trim();
}

function sessionKey(
  platform: TestPlatform,
  field: string,
): string {
  return `${platform}:${field}`;
}

function parseSession(
  platform: TestPlatform,
  values: Map<string, string>,
): PlatformTestSession {
  const storedActive =
    values.get(
      sessionKey(platform, "active"),
    ) === "true";

  const storedRunId =
    text(
      values.get(
        sessionKey(platform, "run_id"),
      ),
    );

  const storedExpiresAt =
    text(
      values.get(
        sessionKey(platform, "expires_at"),
      ),
    );

  const expiryTime =
    storedExpiresAt
      ? Date.parse(storedExpiresAt)
      : 0;

  const active =
    storedActive &&
    Number.isFinite(expiryTime) &&
    expiryTime > Date.now();

  return {
    platform,
    active,
    runId:
      active
        ? storedRunId || null
        : null,
    expiresAt:
      active
        ? storedExpiresAt || null
        : null,
  };
}

async function saveSession(
  input: {
    workspaceId: string;
    platform: TestPlatform;
    active: boolean;
    runId: string | null;
    expiresAt: string | null;
  },
) {
  const entries = [
    {
      assetType:
        sessionKey(
          input.platform,
          "active",
        ),
      assetValue:
        String(input.active),
      assetLabel:
        `${input.platform} test active`,
    },
    {
      assetType:
        sessionKey(
          input.platform,
          "run_id",
        ),
      assetValue:
        input.runId || "",
      assetLabel:
        `${input.platform} test run ID`,
    },
    {
      assetType:
        sessionKey(
          input.platform,
          "expires_at",
        ),
      assetValue:
        input.expiresAt || "",
      assetLabel:
        `${input.platform} test expiry`,
    },
  ];

  await db.$transaction(
    entries.map((entry) =>
      db.shopAssetSelection.upsert({
        where: {
          workspaceId_platform_assetType: {
            workspaceId:
              input.workspaceId,
            platform:
              STORAGE_PLATFORM,
            assetType:
              entry.assetType,
          },
        },
        update: entry,
        create: {
          workspaceId:
            input.workspaceId,
          platform:
            STORAGE_PLATFORM,
          ...entry,
        },
      }),
    ),
  );
}

export async function getPlatformTestSessions(
  workspaceId: string,
) {
  const rows =
    await db.shopAssetSelection.findMany({
      where: {
        workspaceId,
        platform:
          STORAGE_PLATFORM,
      },
      select: {
        assetType: true,
        assetValue: true,
      },
    });

  const values =
    new Map<string, string>(
      rows.map(
        (
          row: {
            assetType: string;
            assetValue: string;
          },
        ) => [
          row.assetType,
          row.assetValue,
        ],
      ),
    );

  return {
    ga4:
      parseSession(
        "ga4",
        values,
      ),
    meta:
      parseSession(
        "meta",
        values,
      ),
  };
}

export async function startPlatformTestSession(
  input: {
    workspaceId: string;
    platform: TestPlatform;
    durationMinutes?: number;
  },
) {
  const requestedDuration =
    Number(input.durationMinutes);

  const durationMinutes =
    Number.isFinite(
      requestedDuration,
    ) &&
    requestedDuration > 0 &&
    requestedDuration <= 120
      ? requestedDuration
      : DEFAULT_DURATION_MINUTES;

  const runId =
    `dh_${input.platform}_${randomUUID()
      .replace(/-/g, "")
      .slice(0, 20)}`;

  const expiresAt =
    new Date(
      Date.now() +
      durationMinutes *
        60 *
        1000,
    ).toISOString();

  await saveSession({
    workspaceId:
      input.workspaceId,
    platform:
      input.platform,
    active: true,
    runId,
    expiresAt,
  });

  return getPlatformTestSessions(
    input.workspaceId,
  );
}

export async function stopPlatformTestSession(
  input: {
    workspaceId: string;
    platform: TestPlatform;
  },
) {
  await saveSession({
    workspaceId:
      input.workspaceId,
    platform:
      input.platform,
    active: false,
    runId: null,
    expiresAt: null,
  });

  return getPlatformTestSessions(
    input.workspaceId,
  );
}

/*
 * Retained for compatibility with existing tests
 * and older code paths.
 */
export function resolveEffectiveTestMode(
  input: {
    channel: TestModeChannel;
    globalEnabled: boolean;
    globallySelected: boolean;
    override?:
      TestModeOverride | null;
    environmentOverride?:
      boolean | null;
    mechanism?: string;
  },
): EffectiveTestMode {
  const mechanism =
    input.mechanism ||
    MECHANISMS[input.channel];

  if (
    typeof input.environmentOverride ===
    "boolean"
  ) {
    return {
      enabled:
        input.environmentOverride,
      source:
        "ENVIRONMENT_OVERRIDE",
      mechanism,
    };
  }

  if (
    input.override === "ENABLED"
  ) {
    return {
      enabled: true,
      source:
        "PLATFORM_OVERRIDE",
      mechanism,
    };
  }

  if (
    input.override === "DISABLED"
  ) {
    return {
      enabled: false,
      source:
        "PLATFORM_OVERRIDE",
      mechanism,
    };
  }

  if (
    input.globalEnabled &&
    input.globallySelected
  ) {
    return {
      enabled: true,
      source:
        "GLOBAL_SELECTION",
      mechanism,
    };
  }

  return {
    enabled: false,
    source: "DEFAULT",
    mechanism: "PRODUCTION",
  };
}

function channelResult(
  enabled: boolean,
  mechanism: string,
  session?: PlatformTestSession,
) {
  return {
    selected: enabled,
    override:
      enabled
        ? "ENABLED"
        : "DISABLED",
    effective: {
      enabled,
      source:
        enabled
          ? "PLATFORM_SESSION"
          : "DEFAULT",
      mechanism:
        enabled
          ? mechanism
          : "PRODUCTION",
      runId:
        enabled
          ? session?.runId || null
          : null,
      expiresAt:
        enabled
          ? session?.expiresAt || null
          : null,
    } as EffectiveTestMode,
  };
}

export async function getTestModeSettings(
  workspaceId: string,
) {
  const sessions =
    await getPlatformTestSessions(
      workspaceId,
    );

  const enabled =
    sessions.ga4.active ||
    sessions.meta.active;

  return {
    enabled,
    value:
      enabled
        ? "true"
        : "false",
    label:
      enabled
        ? "Platform test active"
        : "Live Mode",
    sessions,
    channels: {
      ga4_client:
        channelResult(
          sessions.ga4.active,
          MECHANISMS.ga4_client,
          sessions.ga4,
        ),

      ga4_server:
        channelResult(
          sessions.ga4.active,
          MECHANISMS.ga4_server,
          sessions.ga4,
        ),

      google_ads_client:
        channelResult(
          false,
          MECHANISMS.google_ads_client,
        ),

      google_ads_server:
        channelResult(
          false,
          MECHANISMS.google_ads_server,
        ),

      /*
       * Meta Pixel does not use the CAPI
       * Test Event Code.
       */
      meta_pixel:
        channelResult(
          false,
          MECHANISMS.meta_pixel,
        ),

      meta_capi:
        channelResult(
          sessions.meta.active,
          MECHANISMS.meta_capi,
          sessions.meta,
        ),
    },
  };
}

/*
 * Compatibility method for any old caller.
 * The redesigned UI does not use global mode.
 */
export async function saveTestModeSettings(
  data: {
    workspaceId: string;
    enabled: boolean;
    selectedChannels?: string[];
    overrides?: Partial<
      Record<
        TestModeChannel,
        TestModeOverride
      >
    >;
  },
) {
  const selected =
    new Set(
      data.selectedChannels || [],
    );

  const ga4Enabled =
    data.enabled &&
    (
      selected.has("ga4_client") ||
      selected.has("ga4_server")
    );

  const metaEnabled =
    data.enabled &&
    selected.has("meta_capi");

  if (ga4Enabled) {
    await startPlatformTestSession({
      workspaceId:
        data.workspaceId,
      platform: "ga4",
    });
  } else {
    await stopPlatformTestSession({
      workspaceId:
        data.workspaceId,
      platform: "ga4",
    });
  }

  if (metaEnabled) {
    await startPlatformTestSession({
      workspaceId:
        data.workspaceId,
      platform: "meta",
    });
  } else {
    await stopPlatformTestSession({
      workspaceId:
        data.workspaceId,
      platform: "meta",
    });
  }

  return getTestModeSettings(
    data.workspaceId,
  );
}

export async function isTestModeEnabled(
  workspaceId?: string | null,
) {
  return workspaceId
    ? (
        await getTestModeSettings(
          workspaceId,
        )
      ).enabled
    : false;
}
