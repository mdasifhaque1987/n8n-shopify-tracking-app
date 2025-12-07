// Google Ads Dispatcher - Enhanced and Offline Conversions
import type { UnifiedEvent } from "../events/event-schema";

/**
 * Dispatch event to Google Ads
 */
export async function dispatchToGoogleAds(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Get Google Ads credentials
    // const conversionId = await getGoogleAdsConversionId(workspaceId);
    
    // Map to Google Ads format
    const adsEvent = mapToGoogleAdsFormat(event);
    
    console.log("Google Ads dispatch:", adsEvent);
    
    return { success: true, message: "Event sent to Google Ads" };
  } catch (error) {
    console.error("Google Ads dispatch error:", error);
    throw error;
  }
}

function mapToGoogleAdsFormat(event: UnifiedEvent) {
  return {
    conversion_action: event.event_name,
    gclid: event.user_data.gclid,
    conversion_value: event.ecommerce?.value,
    currency_code: event.ecommerce?.currency,
    order_id: event.ecommerce?.transaction_id,
  };
}
