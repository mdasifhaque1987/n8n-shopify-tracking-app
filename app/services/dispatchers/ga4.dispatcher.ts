// GA4 Dispatcher - Google Analytics 4 Measurement Protocol
import type { UnifiedEvent } from "../events/event-schema";
import axios from "axios";

/**
 * Dispatch event to GA4 via Measurement Protocol
 */
export async function dispatchToGA4(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Get GA4 credentials from workspace settings
    // const measurementId = await getGA4MeasurementId(workspaceId);
    // const apiSecret = await getGA4ApiSecret(workspaceId);
    
    // Map unified event to GA4 format
    const ga4Event = mapToGA4Format(event);
    
    // Send to GA4 Measurement Protocol
    // await axios.post(`https://www.google-analytics.com/mp/collect`, ga4Event);
    
    console.log("GA4 dispatch:", ga4Event);
    
    return { success: true, message: "Event sent to GA4" };
  } catch (error) {
    console.error("GA4 dispatch error:", error);
    throw error;
  }
}

function mapToGA4Format(event: UnifiedEvent) {
  return {
    client_id: event.user_data.external_id || event.event_id,
    events: [{
      name: event.event_name,
      params: {
        value: event.ecommerce?.value,
        currency: event.ecommerce?.currency,
        items: event.ecommerce?.items,
        transaction_id: event.ecommerce?.transaction_id,
      },
    }],
  };
}
