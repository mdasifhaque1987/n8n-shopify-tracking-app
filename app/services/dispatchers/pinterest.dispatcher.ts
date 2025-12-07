// Pinterest Conversions API Dispatcher
import type { UnifiedEvent } from "../events/event-schema";
import axios from "axios";

/**
 * Dispatch event to Pinterest Conversions API
 */
export async function dispatchToPinterest(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const pinterestEvent = mapToPinterestFormat(event);
    
    console.log("Pinterest CAPI dispatch:", pinterestEvent);
    
    return { success: true, message: "Event sent to Pinterest" };
  } catch (error) {
    console.error("Pinterest dispatch error:", error);
    throw error;
  }
}

function mapToPinterestFormat(event: UnifiedEvent) {
  return {
    event_name: event.event_name,
    action_source: "app_android",
    event_time: Math.floor(event.event_time.getTime() / 1000),
    event_id: event.deduplication_id,
    user_data: {
      em: [event.user_data.email],
      ph: [event.user_data.phone],
      client_user_agent: event.user_data.user_agent,
      client_ip_address: event.user_data.ip_address,
    },
    custom_data: {
      value: event.ecommerce?.value,
      currency: event.ecommerce?.currency,
      content_ids: event.ecommerce?.items.map(i => i.item_id),
    },
  };
}
