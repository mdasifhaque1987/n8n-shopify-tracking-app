// Rate limiting for platform API calls
interface RateLimiter {
  checkLimit(platform: string): Promise<boolean>;
  recordRequest(platform: string): Promise<void>;
}

class InMemoryRateLimiter implements RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private limits: Map<string, { requests: number; window: number }> = new Map([
    ["ga4", { requests: 100, window: 60000 }], // 100 req/min
    ["meta", { requests: 200, window: 3600000 }], // 200 req/hour
    ["google_ads", { requests: 50, window: 60000 }], // 50 req/min
    ["tiktok", { requests: 100, window: 60000 }], // 100 req/min
    ["pinterest", { requests: 100, window: 60000 }], // 100 req/min
    ["linkedin", { requests: 50, window: 60000 }], // 50 req/min
    ["microsoft", { requests: 100, window: 60000 }], // 100 req/min
  ]);
  
  async checkLimit(platform: string): Promise<boolean> {
    const now = Date.now();
    const limit = this.limits.get(platform);
    
    if (!limit) return true;
    
    const requests = this.requests.get(platform) || [];
    const recentRequests = requests.filter(time => now - time < limit.window);
    
    return recentRequests.length < limit.requests;
  }
  
  async recordRequest(platform: string): Promise<void> {
    const now = Date.now();
    const requests = this.requests.get(platform) || [];
    const limit = this.limits.get(platform);
    
    if (limit) {
      const recentRequests = requests.filter(time => now - time < limit.window);
      recentRequests.push(now);
      this.requests.set(platform, recentRequests);
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter();
