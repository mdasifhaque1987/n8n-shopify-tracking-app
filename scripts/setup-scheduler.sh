#!/bin/bash

# Google Cloud Scheduler Setup Script
# 
# Creates Cloud Scheduler jobs for background workers
# Run with: ./scripts/setup-scheduler.sh

set -e

PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"your-project-id"}
REGION=${GOOGLE_CLOUD_REGION:-"us-east1"}
APP_URL=${APP_URL:-"https://your-app.fly.dev"}

echo "🔧 Setting up Google Cloud Scheduler jobs..."
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "App URL: $APP_URL"
echo ""

# Ensure Cloud Scheduler API is enabled
echo "Enabling Cloud Scheduler API..."
gcloud services enable cloudscheduler.googleapis.com --project=$PROJECT_ID

# Create or update token refresh job (every 30 minutes)
echo "Creating token refresh job..."
gcloud scheduler jobs create http token-refresh-job \
  --location=$REGION \
  --schedule="*/30 * * * *" \
  --uri="$APP_URL/api/workers/token-refresh" \
  --http-method=POST \
  --oidc-service-account-email="scheduler@$PROJECT_ID.iam.gserviceaccount.com" \
  --project=$PROJECT_ID \
  --description="Refresh OAuth tokens expiring within 24 hours" \
  --attempt-deadline=5m \
  || gcloud scheduler jobs update http token-refresh-job \
  --location=$REGION \
  --schedule="*/30 * * * *" \
  --uri="$APP_URL/api/workers/token-refresh" \
  --project=$PROJECT_ID

# Create or update usage reset job (daily at midnight)
echo "Creating usage reset job..."
gcloud scheduler jobs create http usage-reset-job \
  --location=$REGION \
  --schedule="0 0 * * *" \
  --uri="$APP_URL/api/workers/usage-reset" \
  --http-method=POST \
  --oidc-service-account-email="scheduler@$PROJECT_ID.iam.gserviceaccount.com" \
  --project=$PROJECT_ID \
  --description="Reset monthly usage counters and cleanup old data" \
  --time-zone="America/New_York" \
  --attempt-deadline=10m \
  || gcloud scheduler jobs update http usage-reset-job \
  --location=$REGION \
  --schedule="0 0 * * *" \
  --uri="$APP_URL/api/workers/usage-reset" \
  --project=$PROJECT_ID

echo "✅ Cloud Scheduler setup complete!"
echo ""
echo "List all jobs:"
echo "gcloud scheduler jobs list --location=$REGION --project=$PROJECT_ID"
