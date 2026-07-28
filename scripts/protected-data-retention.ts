import {
  Prisma,
} from "@prisma/client";
import db from "../app/db.server.js";

const DAY_MS =
  24 *
  60 *
  60 *
  1000;

function retentionDays(
  name: string,
  defaultValue: number,
): number {
  const parsed =
    Number(
      process.env[name],
    );

  if (
    !Number.isFinite(
      parsed,
    ) ||
    parsed < 1
  ) {
    return defaultValue;
  }

  return Math.floor(
    parsed,
  );
}

function beforeDays(
  days: number,
  now: Date,
): Date {
  return new Date(
    now.getTime() -
    days *
    DAY_MS,
  );
}

const deliveryLogDays =
  retentionDays(
    "DELIVERY_LOG_RETENTION_DAYS",
    90,
  );

const orderJobDays =
  retentionDays(
    "ORDER_JOB_RETENTION_DAYS",
    90,
  );

const accessAuditDays =
  retentionDays(
    "ACCESS_AUDIT_RETENTION_DAYS",
    365,
  );

const now =
  new Date();

const orderJobCutoff =
  beforeDays(
    orderJobDays,
    now,
  );

const results =
  await db.$transaction(
    async (
      transaction:
        Prisma.TransactionClient,
    ) => {
      const scrubbedTerminalJobs =
        await transaction.shopifyOrderJob.updateMany({
          where: {
            status: {
              in: [
                "completed",
                "failed",
                "blocked",
              ],
            },

            OR: [
              {
                encryptedCustomerData: {
                  not: null,
                },
              },
              {
                encryptedTrackingIdentity: {
                  not: null,
                },
              },
            ],
          },

          data: {
            encryptedCustomerData:
              null,

            encryptedTrackingIdentity:
              null,
          },
        });

      const expiredCorrelations =
        await transaction.shopifyCheckoutCorrelation.deleteMany({
          where: {
            expiresAt: {
              lt: now,
            },
          },
        });

      const expiredOauthStates =
        await transaction.oAuthState.deleteMany({
          where: {
            expiresAt: {
              lt: now,
            },
          },
        });

      const expiredSessions =
        await transaction.session.deleteMany({
          where: {
            expires: {
              lt: now,
            },
          },
        });

      const oldDeliveryLogs =
        await transaction.eventDeliveryLog.deleteMany({
          where: {
            createdAt: {
              lt:
                beforeDays(
                  deliveryLogDays,
                  now,
                ),
            },
          },
        });

      const oldAccessLogs =
        await transaction.protectedDataAccessLog.deleteMany({
          where: {
            createdAt: {
              lt:
                beforeDays(
                  accessAuditDays,
                  now,
                ),
            },
          },
        });

      const deletedDeliveries =
        await transaction.$executeRaw(
          Prisma.sql`
            DELETE FROM
              "ShopifyOrderPlatformDelivery"
            WHERE
              "jobId" IN (
                SELECT
                  "id"
                FROM
                  "ShopifyOrderJob"
                WHERE
                  "status" IN (
                    'completed',
                    'failed',
                    'blocked'
                  )
                  AND
                  "completedAt" <
                  ${orderJobCutoff}
              )
          `,
        );

      const oldOrderJobs =
        await transaction.shopifyOrderJob.deleteMany({
          where: {
            status: {
              in: [
                "completed",
                "failed",
                "blocked",
              ],
            },

            completedAt: {
              lt:
                orderJobCutoff,
            },
          },
        });

      return {
        scrubbedTerminalJobs:
          scrubbedTerminalJobs.count,

        expiredCorrelations:
          expiredCorrelations.count,

        expiredOauthStates:
          expiredOauthStates.count,

        expiredSessions:
          expiredSessions.count,

        oldDeliveryLogs:
          oldDeliveryLogs.count,

        oldAccessLogs:
          oldAccessLogs.count,

        deletedDeliveries:
          Number(
            deletedDeliveries,
          ),

        oldOrderJobs:
          oldOrderJobs.count,
      };
    },
  );

console.info(
  "[Protected data retention] Completed",
  {
    deliveryLogDays,
    orderJobDays,
    accessAuditDays,
    ...results,
  },
);

await db.$disconnect();
