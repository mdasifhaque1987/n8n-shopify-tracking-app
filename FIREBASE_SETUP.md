# Phase 1: Firebase Authentication Setup Guide

## Overview
This guide will help you set up Firebase Authentication for the DH Tracking App.

## Prerequisites
- Google Cloud account
- Node.js installed (>= 20.19)
- Access to Firebase Console

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Enter project name: `dh-tracking-app` (or your preferred name)
4. Enable/disable Google Analytics (optional)
5. Click "Create project"

## Step 2: Enable Authentication Methods

1. In Firebase Console, go to **Build** → **Authentication**
2. Click "Get started"
3. Enable the following sign-in methods:
   - **Email/Password**: Enable
   - **Google**: Enable and configure
   - **Facebook**: Enable (requires Facebook App ID - Phase 2)
   - **Twitter**: Enable (for TikTok integration - Phase 2)

### Google OAuth Setup
1. Click on Google provider
2. Enable it
3. Set project support email
4. Add authorized domains (your app domains)
5. Save

## Step 3: Create Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Go to **IAM & Admin** → **Service Accounts**
4. Click "Create Service Account"
5. Enter details:
   - Name: `dh-tracking-firebase-admin`
   - Description: `Firebase Admin SDK for DH Tracking`
6. Grant role: **Firebase Admin SDK Administrator Service Agent**
7. Click "Done"

## Step 4: Generate Private Key

1. Find your service account in the list
2. Click the three dots (⋮) → **Manage keys**
3. Click **Add Key** → **Create new key**
4. Select **JSON** format
5. Click "Create"
6. **IMPORTANT**: Save the downloaded JSON file securely

The JSON file contains:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...@....iam.gserviceaccount.com",
  "client_id": "...",
  ...
}
```

## Step 5: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update the following variables in `.env`:

```bash
# Database (required for PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/dh_tracking?schema=public"

# Firebase Authentication
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----"

# JWT Secret (generate a random 32+ character string)
JWT_SECRET="your-super-secure-random-string-min-32-characters"

# Application
NODE_ENV="development"
PORT="3000"
```

### Generate JWT Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 6: Setup PostgreSQL Database

### Option A: Local PostgreSQL
```bash
# Install PostgreSQL
brew install postgresql  # macOS
sudo apt-get install postgresql  # Ubuntu

# Create database
createdb dh_tracking

# Update DATABASE_URL in .env
DATABASE_URL="postgresql://localhost:5432/dh_tracking?schema=public"
```

### Option B: Cloud PostgreSQL (Recommended for Production)

#### Using Supabase (Free tier available)
1. Go to [Supabase](https://supabase.com/)
2. Create new project
3. Copy connection string
4. Update DATABASE_URL in .env

#### Using Railway (Free tier available)
1. Go to [Railway.app](https://railway.app/)
2. Create new project → Add PostgreSQL
3. Copy connection string
4. Update DATABASE_URL in .env

#### Using Neon (Serverless PostgreSQL)
1. Go to [Neon.tech](https://neon.tech/)
2. Create new project
3. Copy connection string
4. Update DATABASE_URL in .env

## Step 7: Run Database Migrations

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init_auth_system

# (Optional) Open Prisma Studio to view database
npx prisma studio
```

## Step 8: Test Authentication

### Test Email/Password Registration
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234",
    "name": "Test User"
  }'
```

Expected response:
```json
{
  "success": true,
  "user": {
    "id": "...",
    "email": "test@example.com",
    "name": "Test User",
    "role": "USER"
  },
  "workspace": {
    "id": "...",
    "name": "Test User's Workspace",
    "slug": "test-..."
  },
  "token": "eyJhbGc..."
}
```

### Test Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234"
  }'
```

### Test Authenticated Request
```bash
# Use token from login response
curl http://localhost:3000/api/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Step 9: Frontend Integration (Next Steps)

### Install Firebase Client SDK
```bash
npm install firebase
```

### Initialize Firebase in Frontend
```typescript
// app/lib/firebase.client.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

### Get Firebase Config
1. Go to Firebase Console
2. Click gear icon → Project settings
3. Scroll down to "Your apps"
4. Click "Web app" (</> icon)
5. Copy the config object

## Security Checklist

- [ ] Never commit `.env` file to git
- [ ] Never commit Firebase service account JSON to git
- [ ] Use strong JWT secret (32+ characters)
- [ ] Enable HTTPS in production
- [ ] Set proper CORS origins
- [ ] Implement rate limiting (Phase 2)
- [ ] Enable Firebase App Check (Phase 2)
- [ ] Regular security audits

## Troubleshooting

### "Firebase is not initialized" error
- Check that environment variables are set correctly
- Ensure private key format is correct (with `\n` for newlines)
- Verify service account has correct permissions

### Database connection errors
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Ensure database exists
- Check network/firewall settings

### Token verification fails
- Ensure JWT_SECRET is set
- Check token hasn't expired
- Verify token format in Authorization header

## Next Steps

✅ Phase 1 Complete! You now have:
- User authentication (Email/Password + Firebase)
- JWT token generation and verification
- Role-based access control
- Workspace management
- PostgreSQL database

**Ready for Phase 2**: Platform OAuth Connections
- Google Ads & Analytics OAuth
- Meta (Facebook) OAuth
- TikTok OAuth
- Pinterest OAuth
- And more...
