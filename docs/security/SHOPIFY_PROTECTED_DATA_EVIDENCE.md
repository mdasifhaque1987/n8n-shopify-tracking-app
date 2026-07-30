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

<!-- DEPLOYMENT-VERIFICATION-START -->

## Production deployment verification

The protected-customer-data controls were deployed and verified in production.

- Evidence file: `docs/security/evidence/20260730T180555Z-protected-data-deployment.md`
- Source commit: `905fe4c77a70d52b9ec00675b092dd8696e27721`
- Migration: applied
- Historical terminal protected payloads: removed
- Encrypted backup and SHA-256 validation: passed
- Full isolated restore test: passed
- Daily backup, retention and DLP timers: enabled
- Application and worker systemd hardening: active
- Local and public health checks: passed
- Protected-data access-log rows at evidence time: 0

The host full-disk encryption state was not established by this deployment. No synthetic customer-data access was generated solely to create an audit row.

<!-- DEPLOYMENT-VERIFICATION-END -->
