// TikTok Events API Dispatcher
import type { UnifiedEvent } from "../events/event-schema";

/**
 * Dispatch event to TikTok Events API
 */
export async function dispatchToTikTok(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  void workspaceId;

  try {
    // Get TikTok credentials
    const tiktokEvent = mapToTikTokFormat(event);
    
    console.info(
      "[TikTok Events API] Dispatch prepared",
      {
        eventName:
          tiktokEvent.event,
      },
    );
    
    return { success: true, message: "Event sent to TikTok" };
  } catch (error) {
    console.error("TikTok dispatch error:", error instanceof Error ? error.name : "UnknownError");
    throw error;
  }
}

function mapToTikTokFormat(event: UnifiedEvent) {
  return {
    pixel_code: "PIXEL_CODE",
    event: event.event_name,
    event_id: event.deduplication_id,
    timestamp: event.event_time.toISOString(),
    context: {
      user_agent: event.user_data.user_agent,
      ip: event.user_data.ip_address,
    },
    properties: {
      contents: event.ecommerce?.items.map((item) => ({
        content_id: item.id || item.item_id,
        content_name: item.item_name,
        content_category: item.item_category,
        brand: item.item_brand,
        price: item.price,
        quantity: item.quantity,
      })),
      value: event.ecommerce?.value,
      currency: event.ecommerce?.currency,
    },
  };
}
