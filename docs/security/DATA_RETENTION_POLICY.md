# Data Retention Policy

## Purpose

Data Hatches retains personal data only for the shortest period required to deliver merchant-configured conversion tracking, resolve delivery failures, satisfy security obligations and comply with applicable law.

## Operational retention periods

| Data class | Retention |
|---|---|
| Encrypted customer and tracking payloads in order jobs | Deleted immediately when the job reaches completed, failed or blocked status |
| Checkout-correlation records | Seven days |
| OAuth state records | Deleted after expiration |
| Expired application sessions | Deleted by the daily retention job |
| Delivery logs | Ninety days |
| Completed, failed and blocked order-job metadata | Ninety days |
| Protected-data access-audit logs | 365 days |
| Encrypted database backups | Thirty days |

Retention periods may be shortened in response to a valid deletion request or merchant uninstall.

## Deletion

The daily retention process removes expired records and scrubs protected payloads from any previously completed terminal jobs. Shopify privacy webhooks remain the primary mechanism for customer and shop deletion requests.

## Review

This policy is reviewed annually and after material changes to data processing.
