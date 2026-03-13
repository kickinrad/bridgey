export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private config: RateLimitConfig) {
    this.cleanupTimer = setInterval(() => this.cleanup(), config.windowMs).unref();
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(ip: string): boolean {
    const now = Date.now();
    let entry = this.map.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.map.set(ip, entry);
    }

    entry.count++;
    return entry.count <= this.config.maxRequests;
  }

  /** Returns the number of requests remaining in the current window. */
  remaining(ip: string): number {
    const now = Date.now();
    const entry = this.map.get(ip);

    if (!entry || now >= entry.resetAt) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - entry.count);
  }

  /** Remove expired entries from the map. */
  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.map) {
      if (now >= entry.resetAt) {
        this.map.delete(ip);
      }
    }
  }

  /** Stop the cleanup timer. Call this when shutting down. */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.map.clear();
  }
}
