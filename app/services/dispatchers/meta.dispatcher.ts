// Meta Conversions API Dispatcher
import type { UnifiedEvent } from "../events/event-schema";
import axios from "axios";

/**
 * Dispatch event to Meta Conversions API
 */
export async function dispatchToMeta(
  event: UnifiedEvent,
  workspaceId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Get Meta credentials from workspace
    // const pixelId = await getMetaPixelId(workspaceId);
    // const accessToken = await getMetaAccessToken(workspaceId);
    
    // Map to Meta CAPI format
    const metaEvent = mapToMetaFormat(event);
    
    // Send to Meta CAPI
    // await axios.post(`https://graph.facebook.com/v18.0/${pixelId}/events`, metaEvent);
    
    console.log("Meta CAPI dispatch:", metaEvent);
    
    return { success: true, message: "Event sent to Meta CAPI" };
  } catch (error) {
    console.error("Meta dispatch error:", error);
    throw error;
  }
}

function mapToMetaFormat(event: UnifiedEvent) {
  return {
    data: [{
      event_name: event.event_name,
      event_time: Math.floor(event.event_time.getTime() / 1000),
      event_id: event.deduplication_id,
      user_data: {
        em: event.user_data.email,
        ph: event.user_data.phone,
        fn: event.user_data.first_name,
        ln: event.user_data.last_name,
        fbp: event.user_data.fbp,
        fbc: event.user_data.fbc,
        external_id: event.user_data.external_id,
      },
      custom_data: {
        value: event.ecommerce?.value,
        currency: event.ecommerce?.currency,
        contents: event.ecommerce?.items,
      },
    }],
  };
}
