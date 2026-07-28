CREATE TABLE "ProtectedDataAccessLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "shop" TEXT,
    "actorType" TEXT NOT NULL,
    "actorReferenceHash" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceReferenceHash" TEXT,
    "resourceCount" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectedDataAccessLog_pkey"
    PRIMARY KEY ("id")
);

CREATE INDEX
"ProtectedDataAccessLog_workspaceId_createdAt_idx"
ON "ProtectedDataAccessLog"(
    "workspaceId",
    "createdAt"
);

CREATE INDEX
"ProtectedDataAccessLog_shop_createdAt_idx"
ON "ProtectedDataAccessLog"(
    "shop",
    "createdAt"
);

CREATE INDEX
"ProtectedDataAccessLog_action_createdAt_idx"
ON "ProtectedDataAccessLog"(
    "action",
    "createdAt"
);

CREATE INDEX
"ProtectedDataAccessLog_createdAt_idx"
ON "ProtectedDataAccessLog"(
    "createdAt"
);
