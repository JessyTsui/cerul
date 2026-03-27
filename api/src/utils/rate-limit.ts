import type { RateLimitLease } from "../types";

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export class InMemoryTokenBucketRateLimiter {
  private buckets = new Map<string, BucketState>();

  async acquire(bucketId: string, rateLimitPerSec: number): Promise<RateLimitLease> {
    if (rateLimitPerSec <= 0) {
      return {
        allowed: true,
        limit: rateLimitPerSec,
        remaining: null,
        retry_after_seconds: 0
      };
    }

    const now = Date.now() / 1000;
    const refillRate = rateLimitPerSec;
    const existing = this.buckets.get(bucketId);
    const state = existing ?? { tokens: refillRate, updatedAt: now };

    if (existing) {
      const elapsed = Math.max(now - state.updatedAt, 0);
      state.tokens = Math.min(refillRate, state.tokens + elapsed * refillRate);
      state.updatedAt = now;
    }

    if (state.tokens >= 1) {
      state.tokens -= 1;
      state.updatedAt = now;
      this.buckets.set(bucketId, state);
      return {
        allowed: true,
        limit: rateLimitPerSec,
        remaining: Math.max(Math.floor(state.tokens), 0),
        retry_after_seconds: 0
      };
    }

    this.buckets.set(bucketId, state);
    return {
      allowed: false,
      limit: rateLimitPerSec,
      remaining: 0,
      retry_after_seconds: (1 - state.tokens) / refillRate
    };
  }
}

let rateLimiter: InMemoryTokenBucketRateLimiter | null = null;

export function getRateLimiter(): InMemoryTokenBucketRateLimiter {
  if (rateLimiter == null) {
    rateLimiter = new InMemoryTokenBucketRateLimiter();
  }
  return rateLimiter;
}
