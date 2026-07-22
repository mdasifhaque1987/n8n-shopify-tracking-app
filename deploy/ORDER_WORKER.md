# Shopify order worker deployment

The worker uses the same application build, PostgreSQL `DATABASE_URL`, Shopify credentials,
Partner API credentials, platform credentials, and `ENCRYPTION_KEY` as the web process.
Run exactly one or more worker processes; PostgreSQL row leases and `FOR UPDATE SKIP LOCKED`
prevent concurrent processing of the same order job.

## systemd

1. Install the application at `/opt/dh-tracking-app` and run `npm ci`, `npm run build`, and
   `npx prisma migrate deploy`.
2. Put production variables in `/etc/dh-tracking-app.env`, readable only by root and the
   `dh-tracking` service account.
3. Copy `deploy/dh-orders-worker.service` to `/etc/systemd/system/`.
4. Run `sudo systemctl daemon-reload`.
5. Run `sudo systemctl enable --now dh-orders-worker.service`.
6. Inspect sanitized worker status with `sudo systemctl status dh-orders-worker.service`.

For Fly.io, `fly.toml` defines a separate `worker` process. Scale it independently with:

```sh
fly scale count app=1 worker=1
```
