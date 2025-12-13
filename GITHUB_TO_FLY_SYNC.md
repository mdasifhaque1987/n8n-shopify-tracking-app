# GitHub to Fly.io Sync Guide

This guide explains how to sync your latest code from GitHub to Fly.io deployment.

## 🚀 Automatic Deployment (Recommended)

The app has GitHub Actions configured for automatic deployment to Fly.io.

### Setup (One-Time)

1. **Get your Fly.io API token:**
   ```powershell
   flyctl auth token
   ```

2. **Add token to GitHub:**
   - Go to: https://github.com/mdasifhaque1987/dh-tracking-app-new/settings/secrets/actions
   - Click "New repository secret"
   - Name: `FLY_API_TOKEN`
   - Value: (paste your token from step 1)
   - Click "Add secret"

### Deploy Automatically

**Option 1: Push to main branch**
```powershell
cd D:\dh-tracking-app-new
git checkout main
git merge copilot/initial-sync-local-folder
git push origin main
```

GitHub Actions will automatically deploy to Fly.io. Monitor progress at:
https://github.com/mdasifhaque1987/dh-tracking-app-new/actions

**Option 2: Manual trigger from GitHub**
1. Go to: https://github.com/mdasifhaque1987/dh-tracking-app-new/actions/workflows/fly-deploy.yml
2. Click "Run workflow"
3. Select branch: `copilot/initial-sync-local-folder`
4. Click "Run workflow"

## 🔧 Manual Deployment

If you prefer manual deployment:

### Step 1: Sync from GitHub to Local

```powershell
# Navigate to project directory
cd D:\dh-tracking-app-new

# Fetch latest changes
git fetch origin

# Pull latest code
git pull origin copilot/initial-sync-local-folder

# Verify you have latest changes
git log --oneline -5
```

### Step 2: Deploy to Fly.io

```powershell
# Deploy to Fly.io
fly deploy -a dh-tracking-app-new

# Monitor deployment status
fly status -a dh-tracking-app-new

# Check logs
fly logs -a dh-tracking-app-new
```

## 📋 Latest Changes (Commit 04b609f)

The most recent update includes:

✅ **Platform Connections Page** (`/app/connections`)
- OAuth buttons for Google, Meta, TikTok, Pinterest, Microsoft, LinkedIn
- Connection status indicators
- Platform-specific setup instructions

✅ **Shopify Web Pixel Extension**
- Multi-platform tracking pixel injection
- Automatic event tracking (PageView, ViewContent, AddToCart, Purchase)
- Dynamic configuration from merchant settings
- Location: `extensions/tracking-pixel/`

✅ **Enhanced Settings Page**
- Pixel count display
- Link to Platform Connections
- Status badges
- Merchant instructions

✅ **OAuth Init Routes**
- `/api/oauth/google-init`
- `/api/oauth/meta-init` (existing)
- `/api/oauth/tiktok-init` ✨ NEW
- `/api/oauth/pinterest-init` ✨ NEW
- `/api/oauth/microsoft-init` ✨ NEW
- `/api/oauth/linkedin-init` ✨ NEW

✅ **Pixel Configuration API**
- `/api/pixel-config` - Provides pixel settings to storefront

## 🔍 Verify Deployment

After deployment, verify these features:

1. **App is running:**
   ```powershell
   fly status -a dh-tracking-app-new
   ```
   Should show: `Status = running`

2. **Access the app:**
   - URL: https://dh-tracking-app-new.fly.dev
   - Should show Shopify embedded app interface

3. **Test Platform Connections page:**
   - Navigate to Settings → Platform Connections
   - Should see 6 platform cards with "Connect" buttons

4. **Check Settings page:**
   - Should show "7 pixels configured" (or actual count)
   - Link to Platform Connections should be visible

## 🐛 Troubleshooting

### Deployment fails
```powershell
# Check logs
fly logs -a dh-tracking-app-new

# Check secrets
fly secrets list -a dh-tracking-app-new
```

Required secrets:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `HOST`
- `DATABASE_URL` (if using PostgreSQL)

### Git sync issues
```powershell
# Reset local to match remote
git fetch origin
git reset --hard origin/copilot/initial-sync-local-folder

# Verify
git status
```

### App not loading
1. Check Fly.io status: https://status.fly.io
2. Verify secrets are set: `fly secrets list -a dh-tracking-app-new`
3. Check app is using correct port (3000)
4. Review logs: `fly logs -a dh-tracking-app-new`

## 📞 Support

- Fly.io Docs: https://fly.io/docs
- Fly.io Status: https://status.fly.io
- GitHub Actions: https://github.com/mdasifhaque1987/dh-tracking-app-new/actions

## 🎯 Next Steps

After successful deployment:

1. **Configure Shopify OAuth scopes** in Partners Dashboard
2. **Test OAuth flows** for each platform
3. **Deploy web pixel extension:**
   ```powershell
   cd extensions/tracking-pixel
   shopify app deploy
   ```
4. **Test tracking** on your Shopify store
5. **Monitor events** in platform dashboards

---

**App URL:** https://dh-tracking-app-new.fly.dev  
**Latest Commit:** 04b609f  
**Deployment Method:** GitHub Actions (automatic) or Manual via `fly deploy`
