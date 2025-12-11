/**
 * API Route: Token Refresh Worker
 * 
 * Triggered by Google Cloud Scheduler every 30 minutes
 * Refreshes OAuth tokens expiring within 24 hours
 */

import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { tokenRefreshWorker } from "~/workers/token-refresh.worker";

export const action: ActionFunction = async ({ request }) => {
  // Verify request is from Google Cloud Scheduler
  // In production, verify the OIDC token
  const authHeader = request.headers.get('authorization');
  
  if (process.env.NODE_ENV === 'production' && !authHeader) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    await tokenRefreshWorker();
    
    return json({
      success: true,
      message: 'Token refresh completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Token refresh worker failed:', error);
    
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
};
