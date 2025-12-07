// Event ingestion API endpoint
import type { ActionFunctionArgs } from "react-router";
import { processEvent } from "../../../services/events/event-processor";
import type { UnifiedEvent } from "../../../services/events/event-schema";

/**
 * POST /api/events/track
 * Ingest and process tracking events
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = await request.json();
    
    // Extract workspace ID from auth header or body
    const workspaceId = body.workspaceId || request.headers.get("X-Workspace-ID");
    
    if (!workspaceId) {
      return Response.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }
    
    // Validate event structure
    const event = validateAndNormalizeEvent(body);
    
    // Process event
    const result = await processEvent(event, workspaceId);
    
    return Response.json({
      success: result.success,
      event_id: event.event_id,
      deduplication_id: event.deduplication_id,
      results: result.results,
    });
  } catch (error) {
    console.error("Event API error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

function validateAndNormalizeEvent(body: unknown): UnifiedEvent {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid event body");
  }
  
  const event = body as Record<string, unknown>;
  
  if (!event.event_name || !event.source) {
    throw new Error("Missing required fields: event_name, source");
  }
  
  if (!event.event_id) {
    event.event_id = crypto.randomUUID();
  }
  
  if (!event.deduplication_id) {
    event.deduplication_id = event.event_id;
  }
  
  if (!event.event_time) {
    event.event_time = new Date();
  } else if (typeof event.event_time === "string" || typeof event.event_time === "number") {
    event.event_time = new Date(event.event_time);
  }
  
  if (!event.user_data) {
    event.user_data = {};
  }
  
  if (!event.consent) {
    event.consent = {
      ad_storage: true,
      analytics_storage: true,
      ad_user_data: true,
      ad_personalization: true,
    };
  }
  
  if (!event.customer) {
    event.customer = {
      is_new_customer: false,
      lifetime_value: 0,
      order_count: 0,
    };
  }
  
  if (!event.platform_flags) {
    event.platform_flags = {
      send_to_ga4: false,
      send_to_google_ads: false,
      send_to_meta: false,
      send_to_tiktok: false,
      send_to_pinterest: false,
      send_to_linkedin: false,
      send_to_microsoft: false,
    };
  }
  
  return event as UnifiedEvent;
}
