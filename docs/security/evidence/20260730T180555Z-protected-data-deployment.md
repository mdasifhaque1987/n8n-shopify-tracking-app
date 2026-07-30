# Protected Customer Data Deployment Evidence

## Deployment identity

- Evidence recorded at: 20260730T180555Z
- Branch: feat/shopify-app-pricing
- Source commit: 905fe4c77a70d52b9ec00675b092dd8696e27721
- Production domain: tracking.datahatches.com

## Application validation

- Prisma schema validation: passed
- Targeted ESLint validation: passed
- TypeScript validation: passed
- Production application build: passed
- Order worker build: passed
- Retention executable build: passed

## Database and retention controls

- ProtectedDataAccessLog migration: applied
- ProtectedDataAccessLog table: confirmed
- Protected-data access-log rows at evidence time: 0
- Terminal jobs containing protected customer or tracking payloads: 0
- Expired OAuth states: 0
- Expired sessions: 0
- Delivery logs older than 90 days: 0
- Retention service result: success

No synthetic customer-data access was generated merely to populate the audit table. Audit rows will be produced when deployed protected-data access paths are used.

## Backup and recovery controls

- Latest encrypted backup: shopify_db-20260730T175600202167970Z.dump.gpg
- Backup checksum verification: passed
- Backup encryption credential permissions: 640 root:postgres
- Encrypted backup directory permissions: 700 postgres:postgres
- Isolated full database restore test: passed
- Restored application tables during test: 18
- Restored ProtectedDataAccessLog table: confirmed
- Restored terminal protected payload count: 0
- Daily encrypted-backup timer: active and enabled

## DLP controls

- Full-event dispatcher logging removal: deployed
- Raw OAuth-response logging removal: deployed
- Production journal DLP scan result: success
- Daily DLP timer: active and enabled

## Service access controls

Both the application and order worker have the following effective controls:

- NoNewPrivileges: enabled
- PrivateTmp: enabled
- PrivateDevices: enabled
- UMask: 0077
- ProtectSystem: full
- ProtectHome: read-only
- ProtectKernelTunables: enabled
- ProtectKernelModules: enabled
- ProtectKernelLogs: enabled
- ProtectControlGroups: enabled
- RestrictNamespaces: enabled
- LockPersonality: enabled
- Network address families restricted to Unix, IPv4 and IPv6 sockets

## Runtime health

- Application service: active
- Order worker service: active
- Local health check: HTTP 200
- Public health check: HTTP 200
- Daily retention timer: active and enabled

## Scope limitations

- This deployment verifies encrypted database backups, application-level field handling, retention, audit infrastructure, DLP scanning and service hardening.
- This deployment does not establish that the host operating system uses full-disk encryption.
- A zero access-log row count means no applicable protected-data access was observed after deployment at evidence time; it does not mean the audit infrastructure is absent.
- This evidence supports, but does not independently certify, any Shopify Partner Dashboard declaration.
- Partner Dashboard answers must remain accurate for the application's actual production architecture and operating procedures.

No database password, encryption passphrase, API credential, OAuth token or protected customer value is included in this evidence.
