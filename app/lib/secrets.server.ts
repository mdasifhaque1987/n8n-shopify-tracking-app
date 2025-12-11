/**
 * Google Secret Manager Integration
 * 
 * Fetches secrets from Google Cloud Secret Manager at application startup
 * This ensures sensitive credentials are never committed to the repository
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

interface Secrets {
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
  META_APP_SECRET: string;
  TIKTOK_APP_SECRET: string;
  PINTEREST_APP_SECRET: string;
  LINKEDIN_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_SECRET: string;
  DATABASE_URL: string;
  REDIS_URL?: string;
}

let secretsCache: Secrets | null = null;

/**
 * Initialize Google Secret Manager client
 */
export function getSecretManagerClient() {
  // In production, use workload identity
  // In development, use service account key from GOOGLE_APPLICATION_CREDENTIALS
  return new SecretManagerServiceClient();
}

/**
 * Fetch a single secret from Google Secret Manager
 */
export async function getSecret(secretName: string, version: string = 'latest'): Promise<string> {
  const client = getSecretManagerClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT or GCP_PROJECT environment variable must be set');
  }

  const name = `projects/${projectId}/secrets/${secretName}/versions/${version}`;

  try {
    const [response] = await client.accessSecretVersion({ name });
    const payload = response.payload?.data?.toString();
    
    if (!payload) {
      throw new Error(`Secret ${secretName} is empty`);
    }
    
    return payload;
  } catch (error) {
    console.error(`Error fetching secret ${secretName}:`, error);
    throw error;
  }
}

/**
 * Load all application secrets from Google Secret Manager
 * Results are cached for the lifetime of the application
 */
export async function loadSecrets(): Promise<Secrets> {
  // Return cached secrets if available
  if (secretsCache) {
    return secretsCache;
  }

  // In development, use environment variables
  if (process.env.NODE_ENV !== 'production') {
    console.log('Development mode: Using .env file for secrets');
    secretsCache = {
      JWT_SECRET: process.env.JWT_SECRET!,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      META_APP_SECRET: process.env.META_APP_SECRET!,
      TIKTOK_APP_SECRET: process.env.TIKTOK_APP_SECRET!,
      PINTEREST_APP_SECRET: process.env.PINTEREST_APP_SECRET!,
      LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET!,
      MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET!,
      DATABASE_URL: process.env.DATABASE_URL!,
      REDIS_URL: process.env.REDIS_URL,
    };
    return secretsCache;
  }

  // In production, fetch from Google Secret Manager
  console.log('Production mode: Loading secrets from Google Secret Manager');

  try {
    const [
      jwtSecret,
      encryptionKey,
      stripeSecretKey,
      stripeWebhookSecret,
      googleClientSecret,
      metaAppSecret,
      tiktokAppSecret,
      pinterestAppSecret,
      linkedinClientSecret,
      microsoftClientSecret,
      databaseUrl,
    ] = await Promise.all([
      getSecret('JWT_SECRET'),
      getSecret('ENCRYPTION_KEY'),
      getSecret('STRIPE_SECRET_KEY'),
      getSecret('STRIPE_WEBHOOK_SECRET'),
      getSecret('GOOGLE_CLIENT_SECRET'),
      getSecret('META_APP_SECRET'),
      getSecret('TIKTOK_APP_SECRET'),
      getSecret('PINTEREST_APP_SECRET'),
      getSecret('LINKEDIN_CLIENT_SECRET'),
      getSecret('MICROSOFT_CLIENT_SECRET'),
      getSecret('DATABASE_URL'),
    ]);

    // Optional: Redis URL
    let redisUrl: string | undefined;
    try {
      redisUrl = await getSecret('REDIS_URL');
    } catch {
      console.log('REDIS_URL not found in Secret Manager, skipping');
    }

    secretsCache = {
      JWT_SECRET: jwtSecret,
      ENCRYPTION_KEY: encryptionKey,
      STRIPE_SECRET_KEY: stripeSecretKey,
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      GOOGLE_CLIENT_SECRET: googleClientSecret,
      META_APP_SECRET: metaAppSecret,
      TIKTOK_APP_SECRET: tiktokAppSecret,
      PINTEREST_APP_SECRET: pinterestAppSecret,
      LINKEDIN_CLIENT_SECRET: linkedinClientSecret,
      MICROSOFT_CLIENT_SECRET: microsoftClientSecret,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
    };

    console.log('✅ Successfully loaded all secrets from Google Secret Manager');
    return secretsCache;
  } catch (error) {
    console.error('❌ Failed to load secrets from Google Secret Manager:', error);
    throw error;
  }
}

/**
 * Get cached secrets (must call loadSecrets() first)
 */
export function getSecrets(): Secrets {
  if (!secretsCache) {
    throw new Error('Secrets not loaded. Call loadSecrets() first.');
  }
  return secretsCache;
}

/**
 * Clear secrets cache (useful for testing)
 */
export function clearSecretsCache() {
  secretsCache = null;
}
