# Shopify Protected Customer Data Evidence

## Application controls

- Customer and tracking payloads are encrypted before storage.
- Terminal order jobs immediately clear encrypted customer and tracking payloads.
- A daily retention executable deletes expired OAuth states, expired sessions, expired checkout correlations and records beyond documented retention periods.
- Protected-data access is recorded in a dedicated audit table.
- Actor and resource references are hashed.
- Full event payload logging is prohibited and removed from dispatchers.
- OAuth and encryption failures log sanitized error classes instead of raw provider objects.
- Shopify-authenticated routes enforce merchant workspace isolation.
- Privacy webhook deletion services remain enabled.

## Infrastructure controls

Infrastructure evidence is completed when the encrypted-backup and retention systemd timers are deployed, verified and restore-tested.
