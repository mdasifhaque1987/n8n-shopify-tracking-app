# Fly.io GitHub Integration Setup Guide

## ✅ GitHub Actions Automatic Deployment

A GitHub Actions workflow has been created at `.github/workflows/fly-deploy.yml` that will automatically deploy your app to Fly.io when you push to the `main` or `master` branch.

## Setup Instructions

### 1. Get Your Fly.io API Token

Run this command locally:
```bash
flyctl auth token
```

This will output your Fly.io API token. Copy it.

### 2. Add Token to GitHub Secrets

1. Go to your GitHub repository: `https://github.com/mdasifhaque1987/dh-tracking-app-new`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `FLY_API_TOKEN`
5. Value: Paste the token from step 1
6. Click **Add secret**

### 3. Create Fly.io App (First Time Only)

Before the first deployment, create your Fly.io app:

```bash
# Login to Fly.io
flyctl auth login

# Create app (choose a unique name)
flyctl launch --no-deploy

# Create PostgreSQL database
flyctl postgres create

# Attach database to app
flyctl postgres attach <postgres-app-name>
```

### 4. Configure Secrets in Fly.io

You have two options for managing secrets:

#### Option A: Use Fly.io Secrets (Simpler)
```bash
flyctl secrets set \
  JWT_SECRET="your-jwt-secret-here" \
  ENCRYPTION_KEY="your-encryption-key-here" \
  STRIPE_SECRET_KEY="your-stripe-key" \
  GOOGLE_CLIENT_SECRET="your-google-secret" \
  META_APP_SECRET="your-meta-secret"
  # ... add all other secrets
```

#### Option B: Use Google Secret Manager (More Secure)
Follow the instructions in `scripts/setup-secrets.sh`

### 5. Deploy

Now when you push to `main` or `master`, GitHub Actions will automatically deploy to Fly.io!

**Manual deployment:**
```bash
# Trigger workflow manually from GitHub UI
# Or push to main branch
git push origin main
```

**View deployment:**
```bash
# Watch logs
flyctl logs

# Check status
flyctl status

# Open in browser
flyctl open
```

## Workflow Features

- ✅ **Automatic deployment** on push to main/master
- ✅ **Manual trigger** via GitHub Actions UI (workflow_dispatch)
- ✅ **Remote builder** - No local Docker needed
- ✅ **Zero-downtime** deployments
- ✅ **Automatic rollback** on failure

## Environment Variables Needed in Fly.io

Set these via `flyctl secrets set` or Google Secret Manager:

### Required Secrets
- `JWT_SECRET` - JWT signing secret
- `ENCRYPTION_KEY` - For encrypting OAuth tokens
- `DATABASE_URL` - PostgreSQL connection (auto-set if using Fly Postgres)

### Stripe
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`

### OAuth Providers
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `META_APP_ID`
- `META_APP_SECRET`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `PINTEREST_CLIENT_ID`
- `PINTEREST_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`

### Firebase (Optional)
- `FIREBASE_SERVICE_ACCOUNT_KEY` (base64 encoded)

## Verify Deployment

After deployment completes:

```bash
# Check health
curl https://your-app.fly.dev/healthz

# Should return HTTP 200 with:
# {
#   "status": "healthy",
#   "uptime": "...",
#   "database": "connected"
# }
```

## Troubleshooting

**Deployment fails:**
- Check logs: `flyctl logs`
- Verify secrets are set: `flyctl secrets list`
- Check app status: `flyctl status`

**Database connection errors:**
- Verify DATABASE_URL is set: `flyctl secrets list`
- Check Postgres is attached: `flyctl postgres list`

**GitHub Actions fails:**
- Verify `FLY_API_TOKEN` secret is set in GitHub
- Check workflow logs in GitHub Actions tab
- Ensure Fly.io app exists (run `flyctl launch` first)

## Next Steps

1. ✅ Set `FLY_API_TOKEN` in GitHub Secrets
2. ✅ Create Fly.io app with `flyctl launch`
3. ✅ Set all environment secrets
4. ✅ Push to main branch to trigger deployment
5. ✅ Monitor deployment in GitHub Actions
6. ✅ Test app at `https://your-app.fly.dev`

---

**Automatic deployments are now enabled!** Every push to main will deploy to Fly.io. 🚀
