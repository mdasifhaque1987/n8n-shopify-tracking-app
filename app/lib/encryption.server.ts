// Token encryption utilities for secure storage of OAuth tokens
import CryptoJS from "crypto-js";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required for token encryption");
}

/**
 * Encrypt sensitive data (access tokens, refresh tokens)
 * Uses AES encryption with the ENCRYPTION_KEY
 */
export function encryptToken(token: string): string {
  try {
    const encrypted = CryptoJS.AES.encrypt(token, ENCRYPTION_KEY as string).toString();
    return encrypted;
  } catch (error) {
    console.error("Error encrypting token:", error);
    throw new Error("Failed to encrypt token");
  }
}

/**
 * Decrypt sensitive data
 */
export function decryptToken(encryptedToken: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedToken, ENCRYPTION_KEY as string);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    
    if (!decrypted) {
      throw new Error("Decryption resulted in empty string");
    }
    
    return decrypted;
  } catch (error) {
    console.error("Error decrypting token:", error);
    throw new Error("Failed to decrypt token");
  }
}

/**
 * Hash data for secure comparison (one-way)
 */
export function hashData(data: string): string {
  return CryptoJS.SHA256(data).toString();
}

/**
 * Generate a secure random string for state parameters
 */
export function generateSecureState(): string {
  return crypto.randomUUID();
}
