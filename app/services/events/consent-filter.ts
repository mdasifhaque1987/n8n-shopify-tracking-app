// Consent filtering for GDPR compliance
import type { UnifiedEvent } from "./event-schema";

/**
 * Apply consent mode filtering to event data
 * Strips PII if user hasn't consented
 */
export function applyConsentFilters(event: UnifiedEvent): UnifiedEvent {
  const filtered = { ...event };
  
  // If no ad_storage consent, remove advertising identifiers
  if (!event.consent.ad_storage) {
    filtered.user_data = {
      ...filtered.user_data,
      fbp: undefined,
      fbc: undefined,
      gclid: undefined,
    };
  }
  
  // If no ad_user_data consent, remove personal data
  if (!event.consent.ad_user_data) {
    filtered.user_data = {
      ...filtered.user_data,
      email: undefined,
      phone: undefined,
      first_name: undefined,
      last_name: undefined,
      address: undefined,
    };
  }
  
  return filtered;
}
