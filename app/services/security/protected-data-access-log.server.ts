import {
  createHash,
} from "node:crypto";
import {
  Prisma,
} from "@prisma/client";
import db from "../../db.server";

type MetadataValue =
  | string
  | number
  | boolean
  | null;

type ProtectedDataAccessInput = {
  workspaceId?: string | null;
  shop?: string | null;
  actorType: string;
  actorReference?: string | null;
  action: string;
  resourceType: string;
  resourceReference?: string | null;
  resourceCount?: number;
  outcome?: string;
  metadata?: Record<string, unknown>;
};

function text(
  value: unknown,
  maximumLength = 191,
): string {
  return value === undefined ||
    value === null
    ? ""
    : String(value)
        .trim()
        .slice(
          0,
          maximumLength,
        );
}

function hashReference(
  value: unknown,
): string | null {
  const normalized =
    text(
      value,
      2048,
    );

  if (!normalized) {
    return null;
  }

  return createHash(
    "sha256",
  )
    .update(
      normalized,
    )
    .digest(
      "hex",
    );
}

function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Prisma.InputJsonObject {
  const output: Record<
    string,
    MetadataValue
  > = {};

  if (!input) {
    return output;
  }

  for (
    const [
      rawKey,
      rawValue,
    ]
    of Object.entries(
      input,
    )
  ) {
    const key =
      text(
        rawKey,
        64,
      );

    if (!key) {
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === "boolean" ||
      typeof rawValue === "number"
    ) {
      output[key] =
        rawValue;

      continue;
    }

    if (
      typeof rawValue ===
      "string"
    ) {
      output[key] =
        text(
          rawValue,
          256,
        );
    }
  }

  return output;
}

export async function writeProtectedDataAccessLog(
  input: ProtectedDataAccessInput,
): Promise<void> {
  const metadata =
    sanitizeMetadata(
      input.metadata,
    );

  try {
    await db.protectedDataAccessLog.create({
      data: {
        workspaceId:
          text(
            input.workspaceId,
          ) ||
          null,

        shop:
          text(
            input.shop,
          ) ||
          null,

        actorType:
          text(
            input.actorType,
            64,
          ) ||
          "unknown",

        actorReferenceHash:
          hashReference(
            input.actorReference,
          ),

        action:
          text(
            input.action,
            96,
          ) ||
          "unknown",

        resourceType:
          text(
            input.resourceType,
            96,
          ) ||
          "unknown",

        resourceReferenceHash:
          hashReference(
            input.resourceReference,
          ),

        resourceCount:
          Number.isFinite(
            input.resourceCount,
          )
            ? Math.max(
                0,
                Math.floor(
                  Number(
                    input.resourceCount,
                  ),
                ),
              )
            : 1,

        outcome:
          text(
            input.outcome,
            32,
          ) ||
          "success",

        ...(
          Object.keys(
            metadata,
          ).length
            ? {
                metadata,
              }
            : {}
        ),
      },
    });
  } catch (error) {
    console.warn(
      "[Protected data access audit] Write failed",
      error instanceof Error
        ? error.name
        : "UnknownError",
    );
  }
}
