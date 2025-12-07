// Crypto utilities for hashing user data
import crypto from "crypto";
import type { UnifiedEvent } from "../events/event-schema";

/**
 * Hash user data with SHA-256 for privacy
 */
export async function hashUserData(event: UnifiedEvent): Promise<UnifiedEvent> {
  const hashed = { ...event };
  
  if (hashed.user_data.email) {
    hashed.user_data.email = hashString(hashed.user_data.email.toLowerCase().trim());
  }
  
  if (hashed.user_data.phone) {
    hashed.user_data.phone = hashString(normalizePhone(hashed.user_data.phone));
  }
  
  if (hashed.user_data.first_name) {
    hashed.user_data.first_name = hashString(hashed.user_data.first_name.toLowerCase().trim());
  }
  
  if (hashed.user_data.last_name) {
    hashed.user_data.last_name = hashString(hashed.user_data.last_name.toLowerCase().trim());
  }
  
  return hashed;
}

/**
 * SHA-256 hash a string
 */
export function hashString(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Normalize phone number (remove non-digits)
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}
