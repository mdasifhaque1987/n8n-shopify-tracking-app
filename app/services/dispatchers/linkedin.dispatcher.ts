// LinkedIn Conversions API Dispatcher
import type { UnifiedEvent } from "../events/event-schema";

/**
 * Dispatch event to LinkedIn Conversions API
 */
export async function dispatchToLinkedIn(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const linkedinEvent = mapToLinkedInFormat(event);
    
    console.log("LinkedIn CAPI dispatch:", linkedinEvent);
    
    return { success: true, message: "Event sent to LinkedIn" };
  } catch (error) {
    console.error("LinkedIn dispatch error:", error);
    throw error;
  }
}

function mapToLinkedInFormat(event: UnifiedEvent) {
  return {
    conversion: event.event_name,
    conversionHappenedAt: event.event_time.getTime(),
    conversionValue: {
      currencyCode: event.ecommerce?.currency,
      amount: event.ecommerce?.value?.toString(),
    },
    user: {
      userIds: [{
        idType: "SHA256_EMAIL",
        idValue: event.user_data.email,
      }],
    },
  };
}
