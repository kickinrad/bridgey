export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}
export declare class RateLimiter {
    private config;
    private map;
    private cleanupTimer;
    constructor(config: RateLimitConfig);
    /** Returns true if the request is allowed, false if rate-limited. */
    check(ip: string): boolean;
    /** Returns the number of requests remaining in the current window. */
    remaining(ip: string): number;
    /** Remove expired entries from the map. */
    cleanup(): void;
    /** Stop the cleanup timer. Call this when shutting down. */
    destroy(): void;
}
