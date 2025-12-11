/**
 * API Route: Usage Reset Worker
 * 
 * Triggered by Google Cloud Scheduler daily at midnight
 * Resets monthly usage counters and cleans up old data
 */

import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { usageResetWorker } from "~/workers/usage-reset.worker";

export const action: ActionFunction = async ({ request }) => {
  // Verify request is from Google Cloud Scheduler
  // In production, verify the OIDC token
  const authHeader = request.headers.get('authorization');
  
  if (process.env.NODE_ENV === 'production' && !authHeader) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    await usageResetWorker();
    
    return json({
      success: true,
      message: 'Usage reset completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Usage reset worker failed:', error);
    
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
