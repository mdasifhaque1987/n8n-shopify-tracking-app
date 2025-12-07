// Event logger - stores event dispatch history
import type { UnifiedEvent } from "./event-schema";
import db from "../../db.server";

/**
 * Log event dispatch to database
 */
export async function logEventDispatch(
  event: UnifiedEvent,
  workspaceId: string,
  results: Record<string, unknown>
): Promise<void> {
  try {
    // Store in database for analytics and debugging
    // This would require an EventLog model in Prisma
    console.log("Event dispatched:", {
      workspace: workspaceId,
      event: event.event_name,
      platforms: Object.keys(results),
      dedup_id: event.deduplication_id,
    });
  } catch (error) {
    console.error("Error logging event:", error);
  }
}
