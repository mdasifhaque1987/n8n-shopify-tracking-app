#!/bin/bash

# Fly.io Deployment Script for Unified Tracking SaaS Platform
# 
# This script automates the deployment process to Fly.io
# Run with: ./scripts/deploy.sh

set -e  # Exit on any error

echo "🚀 Starting deployment to Fly.io..."

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl is not installed"
    echo "Install it from: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

# Check if logged in to Fly.io
if ! flyctl auth whoami &> /dev/null; then
    echo "❌ Not logged in to Fly.io"
    echo "Run: flyctl auth login"
    exit 1
fi

# Build and deploy
echo "📦 Building and deploying application..."
flyctl deploy --remote-only

# Check deployment status
echo "✅ Deployment complete!"
echo ""
echo "📊 Checking application status..."
flyctl status

echo ""
echo "📝 Recent logs:"
flyctl logs --lines 50

echo ""
echo "🌐 Your application is now live!"
echo "Visit: https://$(flyctl info --json | jq -r '.Hostname')"
