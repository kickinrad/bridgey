import { describe, it, expect, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it('allows requests under the limit', () => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('blocks requests over the limit', () => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });

    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(false);
  });

  it('tracks IPs independently', () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    expect(limiter.check('1.1.1.1')).toBe(true);
    expect(limiter.check('2.2.2.2')).toBe(true);
    expect(limiter.check('1.1.1.1')).toBe(false);
    expect(limiter.check('2.2.2.2')).toBe(false);
  });

  it('resets after window expires', async () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });

    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('returns remaining count', () => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

    expect(limiter.remaining('1.2.3.4')).toBe(3);
    limiter.check('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(2);
    limiter.check('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(1);
    limiter.check('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(0);
  });

  it('allows exactly maxRequests then blocks on next (boundary at 10)', () => {
    limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

    // Requests 1-10 should all pass
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('10.0.0.1')).toBe(true);
    }

    // 11th request should be blocked
    expect(limiter.check('10.0.0.1')).toBe(false);
    expect(limiter.remaining('10.0.0.1')).toBe(0);
  });

  it('cleanup removes expired entries', async () => {
    limiter = new RateLimiter({ maxRequests: 5, windowMs: 50 });

    limiter.check('1.1.1.1');
    limiter.check('2.2.2.2');

    await new Promise((r) => setTimeout(r, 60));

    limiter.cleanup();

    // After cleanup, remaining should be back to max (entry was removed)
    expect(limiter.remaining('1.1.1.1')).toBe(5);
    expect(limiter.remaining('2.2.2.2')).toBe(5);
  });
});
