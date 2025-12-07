// Event deduplication system
interface DeduplicationStore {
  has(dedupId: string): Promise<boolean>;
  add(dedupId: string, ttl: number): Promise<void>;
}

class InMemoryDeduplicationStore implements DeduplicationStore {
  private store: Map<string, number> = new Map();
  
  async has(dedupId: string): Promise<boolean> {
    const expiry = this.store.get(dedupId);
    if (!expiry) return false;
    
    // Clean up expired entries
    if (Date.now() > expiry) {
      this.store.delete(dedupId);
      return false;
    }
    
    return true;
  }
  
  async add(dedupId: string, ttl: number): Promise<void> {
    const expiry = Date.now() + ttl;
    this.store.set(dedupId, expiry);
  }
  
  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, expiry] of this.store.entries()) {
      if (now > expiry) {
        this.store.delete(key);
      }
    }
  }
}

export const deduplicationStore = new InMemoryDeduplicationStore();

// Run cleanup every 5 minutes
setInterval(() => deduplicationStore.cleanup(), 5 * 60 * 1000);

/**
 * Check if event is duplicate
 */
export async function isDuplicateEvent(dedupId: string): Promise<boolean> {
  return await deduplicationStore.has(dedupId);
}

/**
 * Mark event as processed (24 hour TTL)
 */
export async function markEventProcessed(dedupId: string): Promise<void> {
  await deduplicationStore.add(dedupId, 24 * 60 * 60 * 1000);
}
