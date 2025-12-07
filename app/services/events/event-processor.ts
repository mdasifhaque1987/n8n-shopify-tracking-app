// Event processor - main orchestrator for unified event handling
import type { UnifiedEvent } from "./event-schema";
import { hashUserData } from "../../lib/utils/crypto.server";
import { applyConsentFilters } from "./consent-filter";
import { isDuplicateEvent, markEventProcessed } from "../../lib/utils/deduplication.server";
import { retryWithBackoff } from "../../lib/utils/retry.server";
import { rateLimiter } from "../../lib/utils/rate-limiter.server";
import { dispatchToGA4 } from "../dispatchers/ga4.dispatcher";
import { dispatchToMeta } from "../dispatchers/meta.dispatcher";
import { dispatchToGoogleAds } from "../dispatchers/google-ads.dispatcher";
import { dispatchToTikTok } from "../dispatchers/tiktok.dispatcher";
import { dispatchToPinterest } from "../dispatchers/pinterest.dispatcher";
import { dispatchToLinkedIn } from "../dispatchers/linkedin.dispatcher";
import { dispatchToMicrosoft } from "../dispatchers/microsoft.dispatcher";
import { logEventDispatch } from "./event-logger";

/**
 * Process a unified event and dispatch to all enabled platforms
 */
export async function processEvent(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; results: Record<string, unknown> }> {
  try {
    // Check for duplicate events
    if (await isDuplicateEvent(event.deduplication_id)) {
      console.log("Duplicate event detected, skipping:", event.deduplication_id);
      return {
        success: false,
        results: { error: "Duplicate event" },
      };
    }
    
    // Hash user data for privacy
    const hashedEvent = await hashUserData(event);
    
    // Apply consent filtering
    const filteredEvent = applyConsentFilters(hashedEvent);
    
    // Dispatch to platforms based on flags with retry and rate limiting
    const dispatches: Promise<unknown>[] = [];
    const results: Record<string, unknown> = {};
    
    if (event.platform_flags.send_to_ga4) {
      dispatches.push(
        dispatchWithRetry("ga4", () => dispatchToGA4(filteredEvent, workspaceId))
          .then(result => { results.ga4 = result; })
          .catch(error => { results.ga4 = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_google_ads) {
      dispatches.push(
        dispatchWithRetry("google_ads", () => dispatchToGoogleAds(filteredEvent, workspaceId))
          .then(result => { results.google_ads = result; })
          .catch(error => { results.google_ads = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_meta) {
      dispatches.push(
        dispatchWithRetry("meta", () => dispatchToMeta(filteredEvent, workspaceId))
          .then(result => { results.meta = result; })
          .catch(error => { results.meta = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_tiktok) {
      dispatches.push(
        dispatchWithRetry("tiktok", () => dispatchToTikTok(filteredEvent, workspaceId))
          .then(result => { results.tiktok = result; })
          .catch(error => { results.tiktok = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_pinterest) {
      dispatches.push(
        dispatchWithRetry("pinterest", () => dispatchToPinterest(filteredEvent, workspaceId))
          .then(result => { results.pinterest = result; })
          .catch(error => { results.pinterest = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_linkedin) {
      dispatches.push(
        dispatchWithRetry("linkedin", () => dispatchToLinkedIn(filteredEvent, workspaceId))
          .then(result => { results.linkedin = result; })
          .catch(error => { results.linkedin = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_microsoft) {
      dispatches.push(
        dispatchWithRetry("microsoft", () => dispatchToMicrosoft(filteredEvent, workspaceId))
          .then(result => { results.microsoft = result; })
          .catch(error => { results.microsoft = { error: error.message }; })
      );
    }
    
    // Wait for all dispatches
    await Promise.allSettled(dispatches);
    
    // Mark event as processed
    await markEventProcessed(event.deduplication_id);
    
    // Log event dispatch
    await logEventDispatch(event, workspaceId, results);
    
    return {
      success: true,
      results,
    };
  } catch (error) {
    console.error("Error processing event:", error);
    return {
      success: false,
      results: { error: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}

/**
 * Dispatch with rate limiting and retry logic
 */
async function dispatchWithRetry<T>(
  platform: string,
  fn: () => Promise<T>
): Promise<T> {
  // Check rate limit
  if (!(await rateLimiter.checkLimit(platform))) {
    throw new Error(`Rate limit exceeded for ${platform}`);
  }
  
  // Execute with retry
  const result = await retryWithBackoff(fn);
  
  // Record request
  await rateLimiter.recordRequest(platform);
  
  return result;
}
