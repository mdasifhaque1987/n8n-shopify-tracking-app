#!/bin/bash

# Google Secret Manager Setup Script
# 
# Creates and stores all required secrets in Google Secret Manager
# Run with: ./scripts/setup-secrets.sh

set -e

PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"your-project-id"}

echo "🔐 Setting up Google Secret Manager..."
echo "Project ID: $PROJECT_ID"
echo ""

# Ensure Secret Manager API is enabled
echo "Enabling Secret Manager API..."
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID

# Function to create or update a secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2
    
    echo "Setting up secret: $secret_name"
    
    # Check if secret exists
    if gcloud secrets describe $secret_name --project=$PROJECT_ID &>/dev/null; then
        echo "Secret exists, adding new version..."
        echo -n "$secret_value" | gcloud secrets versions add $secret_name --data-file=- --project=$PROJECT_ID
    else
        echo "Creating new secret..."
        echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=- --project=$PROJECT_ID
    fi
}

# Prompt for each secret
echo "Please provide the following secrets (or press Enter to skip):"
echo ""

read -p "JWT_SECRET (random 32+ character string): " JWT_SECRET
if [ ! -z "$JWT_SECRET" ]; then
    create_or_update_secret "JWT_SECRET" "$JWT_SECRET"
fi

read -p "ENCRYPTION_KEY (random 32+ character string): " ENCRYPTION_KEY
if [ ! -z "$ENCRYPTION_KEY" ]; then
    create_or_update_secret "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
fi

read -p "DATABASE_URL (PostgreSQL connection string): " DATABASE_URL
if [ ! -z "$DATABASE_URL" ]; then
    create_or_update_secret "DATABASE_URL" "$DATABASE_URL"
fi

read -p "GOOGLE_CLIENT_SECRET: " GOOGLE_CLIENT_SECRET
if [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
    create_or_update_secret "GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET"
fi

read -p "META_APP_SECRET: " META_APP_SECRET
if [ ! -z "$META_APP_SECRET" ]; then
    create_or_update_secret "META_APP_SECRET" "$META_APP_SECRET"
fi

read -p "TIKTOK_APP_SECRET: " TIKTOK_APP_SECRET
if [ ! -z "$TIKTOK_APP_SECRET" ]; then
    create_or_update_secret "TIKTOK_APP_SECRET" "$TIKTOK_APP_SECRET"
fi

read -p "PINTEREST_APP_SECRET: " PINTEREST_APP_SECRET
if [ ! -z "$PINTEREST_APP_SECRET" ]; then
    create_or_update_secret "PINTEREST_APP_SECRET" "$PINTEREST_APP_SECRET"
fi

read -p "LINKEDIN_CLIENT_SECRET: " LINKEDIN_CLIENT_SECRET
if [ ! -z "$LINKEDIN_CLIENT_SECRET" ]; then
    create_or_update_secret "LINKEDIN_CLIENT_SECRET" "$LINKEDIN_CLIENT_SECRET"
fi

read -p "MICROSOFT_CLIENT_SECRET: " MICROSOFT_CLIENT_SECRET
if [ ! -z "$MICROSOFT_CLIENT_SECRET" ]; then
    create_or_update_secret "MICROSOFT_CLIENT_SECRET" "$MICROSOFT_CLIENT_SECRET"
fi

echo ""
echo "✅ Secret Manager setup complete!"
echo ""
echo "List all secrets:"
echo "gcloud secrets list --project=$PROJECT_ID"
