// Unified Event Schema - Master event structure for all platforms
export interface UnifiedEvent {
  // Core event data
  event_name: string;
  source: EventSource;
  event_time: Date;
  event_id: string; // For deduplication
  
  // User data
  user_data: UserData;
  
  // E-commerce data
  ecommerce?: EcommerceData;
  
  // Consent and privacy
  consent: ConsentData;
  
  // Deduplication
  deduplication_id: string;
  
  // Customer intelligence
  customer: CustomerData;
  
  // Platform-specific flags
  platform_flags: PlatformFlags;
  
  // Custom parameters
  custom_params?: Record<string, unknown>;
}

export interface UserData {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  address?: AddressData;
  user_agent?: string;
  ip_address?: string;
  fbp?: string; // Facebook Browser ID
  fbc?: string; // Facebook Click ID
  gclid?: string; // Google Click ID
  external_id?: string; // Customer ID
}

export interface AddressData {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface EcommerceData {
  transaction_id?: string;
  value: number;
  currency: string;
  items: ProductItem[];
  shipping?: number;
  tax?: number;
  coupon?: string;
}

export interface ProductItem {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_category?: string;
  item_variant?: string;
  price: number;
  quantity: number;
}

export interface ConsentData {
  ad_storage: boolean;
  analytics_storage: boolean;
  ad_user_data: boolean;
  ad_personalization: boolean;
}

export interface CustomerData {
  is_new_customer: boolean;
  lifetime_value: number;
  order_count: number;
  first_purchase_date?: Date;
}

export interface PlatformFlags {
  send_to_ga4: boolean;
  send_to_google_ads: boolean;
  send_to_meta: boolean;
  send_to_tiktok: boolean;
  send_to_pinterest: boolean;
  send_to_linkedin: boolean;
  send_to_microsoft: boolean;
}

export type EventSource = 
  | "browser_pixel"
  | "server_side"
  | "shopify_webhook"
  | "api_direct"
  | "offline_upload";

export type EventName =
  | "page_view"
  | "view_item"
  | "add_to_cart"
  | "begin_checkout"
  | "add_payment_info"
  | "purchase"
  | "search"
  | "sign_up"
  | "lead"
  | "custom";
