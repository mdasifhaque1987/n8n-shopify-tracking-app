// Firebase Admin SDK configuration for server-side authentication
import admin from "firebase-admin";

let firebaseApp: admin.app.App;

/**
 * Initialize Firebase Admin SDK
 * This should only be called once at application startup
 */
export function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      console.warn("Firebase credentials not configured. Firebase Auth will not be available.");
      return null;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });

    console.log("Firebase Admin SDK initialized successfully");
    return firebaseApp;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    return null;
  }
}

/**
 * Get Firebase Admin instance
 */
export function getFirebaseAdmin() {
  if (!firebaseApp) {
    return initializeFirebase();
  }
  return firebaseApp;
}

/**
 * Verify Firebase ID token
 * @param idToken - Firebase ID token from client
 * @returns Decoded token with user information
 */
export async function verifyFirebaseToken(idToken: string) {
  const app = getFirebaseAdmin();
  if (!app) {
    throw new Error("Firebase is not initialized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    throw new Error("Invalid or expired token");
  }
}

/**
 * Get user by Firebase UID
 */
export async function getFirebaseUser(uid: string) {
  const app = getFirebaseAdmin();
  if (!app) {
    throw new Error("Firebase is not initialized");
  }

  try {
    const userRecord = await admin.auth().getUser(uid);
    return userRecord;
  } catch (error) {
    console.error("Error getting Firebase user:", error);
    throw new Error("User not found");
  }
}

/**
 * Create custom token for a user
 */
export async function createCustomToken(uid: string, claims?: object) {
  const app = getFirebaseAdmin();
  if (!app) {
    throw new Error("Firebase is not initialized");
  }

  try {
    const customToken = await admin.auth().createCustomToken(uid, claims);
    return customToken;
  } catch (error) {
    console.error("Error creating custom token:", error);
    throw new Error("Failed to create custom token");
  }
}
