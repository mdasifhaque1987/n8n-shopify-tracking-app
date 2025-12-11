/**
 * Background Worker: Usage Reset
 * 
 * Resets daily/monthly usage counters and performs cleanup tasks
 * Runs daily at midnight via Google Cloud Scheduler
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Reset monthly usage counters for all workspaces
 */
async function resetMonthlyUsage(): Promise<void> {
  console.log('Resetting monthly usage counters...');
  
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  
  const result = await prisma.usageRecord.updateMany({
    where: {
      resetAt: {
        lte: now,
      },
    },
    data: {
      count: 0,
      resetAt: nextMonth,
    },
  });
  
  console.log(`✅ Reset ${result.count} usage records`);
}

/**
 * Clean up expired OAuth states (older than 1 hour)
 */
async function cleanupExpiredOAuthStates(): Promise<void> {
  console.log('Cleaning up expired OAuth states...');
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const result = await prisma.oAuthState.deleteMany({
    where: {
      createdAt: {
        lt: oneHourAgo,
      },
    },
  });
  
  console.log(`✅ Deleted ${result.count} expired OAuth states`);
}

/**
 * Clean up old event logs (older than 90 days)
 */
async function cleanupOldEventLogs(): Promise<void> {
  console.log('Cleaning up old event logs...');
  
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  
  // Note: This assumes you have an EventLog model
  // Adjust based on your actual schema
  try {
    const result = await prisma.$executeRaw`
      DELETE FROM "EventLog"
      WHERE "createdAt" < ${ninetyDaysAgo}
    `;
    
    console.log(`✅ Deleted ${result} old event logs`);
  } catch (error) {
    console.log('EventLog cleanup skipped (table may not exist yet)');
  }
}

/**
 * Clean up deduplication records (older than 24 hours)
 * This is handled in-memory currently, but good to have for database-backed deduplication
 */
async function cleanupDeduplicationRecords(): Promise<void> {
  console.log('Deduplication records cleanup (in-memory, no action needed)');
  // If you implement database-backed deduplication, add cleanup here
}

/**
 * Archive old customer purchases (older than 1 year) to separate table
 */
async function archiveOldPurchases(): Promise<void> {
  console.log('Archiving old customer purchases...');
  
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  
  // Count old purchases
  const oldPurchasesCount = await prisma.customerPurchase.count({
    where: {
      createdAt: {
        lt: oneYearAgo,
      },
    },
  });
  
  console.log(`Found ${oldPurchasesCount} purchases older than 1 year`);
  
  // In production, you might move these to an archive table or S3
  // For now, just log them
  if (oldPurchasesCount > 0) {
    console.log(`Consider archiving ${oldPurchasesCount} old purchases`);
  }
}

/**
 * Main worker function
 */
export async function usageResetWorker(): Promise<void> {
  console.log('🔄 Starting usage reset worker...');
  
  try {
    await resetMonthlyUsage();
    await cleanupExpiredOAuthStates();
    await cleanupOldEventLogs();
    await cleanupDeduplicationRecords();
    await archiveOldPurchases();
    
    console.log('✅ Usage reset worker completed successfully');
  } catch (error) {
    console.error('❌ Usage reset worker failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run worker if called directly
if (require.main === module) {
  usageResetWorker()
    .then(() => {
      console.log('Worker completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Worker failed:', error);
      process.exit(1);
    });
}
