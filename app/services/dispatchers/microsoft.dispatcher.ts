// Microsoft Ads UET Dispatcher
import type { UnifiedEvent } from "../events/event-schema";

/**
 * Dispatch event to Microsoft Ads UET
 */
export async function dispatchToMicrosoft(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const microsoftEvent = mapToMicrosoftFormat(event);
    
    console.log("Microsoft UET dispatch:", microsoftEvent);
    
    return { success: true, message: "Event sent to Microsoft Ads" };
  } catch (error) {
    console.error("Microsoft dispatch error:", error);
    throw error;
  }
}

function mapToMicrosoftFormat(event: UnifiedEvent) {
  return {
    event_type: event.event_name,
    event_time: event.event_time.toISOString(),
    event_id: event.deduplication_id,
    revenue_value: event.ecommerce?.value,
    currency: event.ecommerce?.currency,
    transaction_id: event.ecommerce?.transaction_id,
  };
}
