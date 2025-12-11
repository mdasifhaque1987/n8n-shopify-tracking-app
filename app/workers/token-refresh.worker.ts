/**
 * Background Worker: OAuth Token Refresh
 * 
 * Automatically refreshes OAuth tokens that are expiring within 24 hours
 * Runs every 30 minutes via Google Cloud Scheduler
 */

import { PrismaClient } from '@prisma/client';
import { refreshGoogleToken } from '../services/oauth/google.service';
import { refreshPinterestToken } from '../services/oauth/pinterest.service';
import { refreshMicrosoftToken } from '../services/oauth/microsoft.service';
import { refreshMetaToken } from '../services/oauth/meta.service';

const prisma = new PrismaClient();

interface TokenRefreshResult {
  platform: string;
  connectionId: string;
  success: boolean;
  error?: string;
}

/**
 * Check if token is expiring within the next 24 hours
 */
function isTokenExpiringSoon(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  
  const now = new Date();
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  return expiresAt <= twentyFourHoursFromNow;
}

/**
 * Refresh a single platform connection token
 */
async function refreshConnectionToken(connection: any): Promise<TokenRefreshResult> {
  const { id, platform, workspaceId } = connection;
  
  try {
    switch (platform) {
      case 'google':
        await refreshGoogleToken(workspaceId, id);
        break;
      
      case 'pinterest':
        await refreshPinterestToken(workspaceId, id);
        break;
      
      case 'microsoft':
        await refreshMicrosoftToken(workspaceId, id);
        break;
      
      case 'meta':
        // Meta tokens can be extended
        await refreshMetaToken(workspaceId, id);
        break;
      
      case 'tiktok':
      case 'linkedin':
        // These platforms don't support token refresh
        console.log(`${platform} does not support token refresh - requires re-authentication`);
        return {
          platform,
          connectionId: id,
          success: false,
          error: 'Platform does not support token refresh',
        };
      
      default:
        console.log(`Unknown platform: ${platform}`);
        return {
          platform,
          connectionId: id,
          success: false,
          error: 'Unknown platform',
        };
    }
    
    console.log(`✅ Successfully refreshed token for ${platform} connection ${id}`);
    return {
      platform,
      connectionId: id,
      success: true,
    };
  } catch (error) {
    console.error(`❌ Failed to refresh token for ${platform} connection ${id}:`, error);
    return {
      platform,
      connectionId: id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Main worker function
 */
export async function tokenRefreshWorker(): Promise<void> {
  console.log('🔄 Starting OAuth token refresh worker...');
  
  try {
    // Find all connections with tokens expiring in the next 24 hours
    const expiringConnections = await prisma.platformConnection.findMany({
      where: {
        OR: [
          {
            tokenExpiresAt: {
              lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          },
          {
            // Also refresh tokens that are already expired
            tokenExpiresAt: {
              lte: new Date(),
            },
          },
        ],
        // Only refresh active connections
        isActive: true,
      },
    });
    
    console.log(`Found ${expiringConnections.length} connections with expiring tokens`);
    
    if (expiringConnections.length === 0) {
      console.log('✅ No tokens need refreshing');
      return;
    }
    
    // Refresh tokens in parallel (with some rate limiting)
    const results: TokenRefreshResult[] = [];
    const batchSize = 5;
    
    for (let i = 0; i < expiringConnections.length; i += batchSize) {
      const batch = expiringConnections.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(connection => refreshConnectionToken(connection))
      );
      results.push(...batchResults);
      
      // Small delay between batches to avoid overwhelming APIs
      if (i + batchSize < expiringConnections.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Log summary
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Token refresh complete: ${successCount} succeeded, ${failureCount} failed`);
    
    // Log failures for investigation
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.error('Failed refreshes:', JSON.stringify(failures, null, 2));
    }
  } catch (error) {
    console.error('❌ Token refresh worker failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run worker if called directly
if (require.main === module) {
  tokenRefreshWorker()
    .then(() => {
      console.log('Worker completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Worker failed:', error);
      process.exit(1);
    });
}
