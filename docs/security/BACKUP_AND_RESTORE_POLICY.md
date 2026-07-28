# Backup and Restore Policy

## Requirements

Production database backups must:

- Be encrypted before permanent storage
- Never leave an unencrypted dump on disk after the job completes
- Be stored in a root-restricted directory
- Include integrity hashes
- Run automatically each day
- Be retained for thirty days
- Be verified through automated decryption and archive inspection
- Be restore-tested periodically in an isolated environment

## Separation

Backup encryption credentials are stored separately from backup files, remain root-owned and are readable only by root and the dedicated PostgreSQL backup service identity.

## Failure handling

A failed backup or verification produces a failed systemd unit and must be investigated before the next scheduled run.
