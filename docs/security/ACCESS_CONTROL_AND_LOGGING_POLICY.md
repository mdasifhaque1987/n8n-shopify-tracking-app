# Access Control and Logging Policy

## Least privilege

Production application services run as a dedicated non-root operating-system user. Administrative access is restricted to authorized Data Hatches operators.

## Merchant isolation

Embedded application routes authenticate through Shopify and resolve the current merchant workspace before reading workspace records.

## Protected-data access logging

The application records protected-data access events without storing customer data. Audit records contain:

- Workspace and shop context
- Hashed actor reference
- Action and resource type
- Hashed resource reference
- Resource count
- Outcome
- Bounded non-sensitive metadata
- Timestamp

Service access is logged when encrypted order data is decrypted for conversion delivery. Merchant administrative viewing of delivery logs is also recorded.

## Review

Access rights are reviewed at least quarterly and immediately after role or personnel changes. Audit logs are retained for 365 days.
