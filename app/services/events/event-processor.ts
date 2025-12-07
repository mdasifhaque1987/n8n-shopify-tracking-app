// Event processor - main orchestrator for unified event handling
import type { UnifiedEvent } from "./event-schema";
import { hashUserData } from "../../lib/utils/crypto.server";
import { applyConsentFilters } from "./consent-filter";
import { dispatchToGA4 } from "../dispatchers/ga4.dispatcher";
import { dispatchToMeta } from "../dispatchers/meta.dispatcher";
import { dispatchToGoogleAds } from "../dispatchers/google-ads.dispatcher";
import { logEventDispatch } from "./event-logger";

/**
 * Process a unified event and dispatch to all enabled platforms
 */
export async function processEvent(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; results: Record<string, unknown> }> {
  try {
    // Hash user data for privacy
    const hashedEvent = await hashUserData(event);
    
    // Apply consent filtering
    const filteredEvent = applyConsentFilters(hashedEvent);
    
    // Dispatch to platforms based on flags
    const dispatches: Promise<unknown>[] = [];
    const results: Record<string, unknown> = {};
    
    if (event.platform_flags.send_to_ga4) {
      dispatches.push(
        dispatchToGA4(filteredEvent, workspaceId)
          .then(result => { results.ga4 = result; })
          .catch(error => { results.ga4 = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_google_ads) {
      dispatches.push(
        dispatchToGoogleAds(filteredEvent, workspaceId)
          .then(result => { results.google_ads = result; })
          .catch(error => { results.google_ads = { error: error.message }; })
      );
    }
    
    if (event.platform_flags.send_to_meta) {
      dispatches.push(
        dispatchToMeta(filteredEvent, workspaceId)
          .then(result => { results.meta = result; })
          .catch(error => { results.meta = { error: error.message }; })
      );
    }
    
    // Wait for all dispatches
    await Promise.allSettled(dispatches);
    
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
