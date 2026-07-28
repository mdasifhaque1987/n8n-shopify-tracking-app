# Data Loss Prevention Policy

## Data minimization

Only the customer and order attributes required for merchant-configured conversion delivery are processed. Order snapshots exclude unnecessary customer-profile fields.

## Logging controls

Application logs must not contain complete event payloads, raw OAuth responses, access tokens, refresh tokens, API secrets, customer email addresses, phone numbers or postal addresses.

Operational logs may contain event names, status categories, platform names, counts and sanitized error-class names.

## Storage controls

Protected payloads and platform credentials are encrypted before database storage. Audit metadata accepts only bounded scalar values and hashes actor and resource references.

## Transmission controls

Protected data is transmitted only to Shopify and platforms explicitly configured by the merchant. HTTPS is required for external transmission.

## Detection and response

The operator reviews application and service logs for prohibited data patterns and follows the incident-response plan when exposure is suspected.
