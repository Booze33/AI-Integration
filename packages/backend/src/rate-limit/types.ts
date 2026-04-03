/**
 * Rate-Limit Type Definitions
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single rate-limit scope (user / tenant / IP).
 *
 * Every field has a sensible default that can be overridden either via the
 * corresponding environment variable or by passing an explicit value to the
 * middleware factory.
 */
export interface RateLimitConfig {
  /**
   * Length of the fixed time window in milliseconds.
   * Env: RATE_LIMIT_WINDOW_MS  Default: 60_000 (1 minute)
   */
  windowMs: number;

  /**
   * Maximum number of requests allowed within the window for this key.
   * Env: RATE_LIMIT_USER_MAX | RATE_LIMIT_TENANT_MAX | RATE_LIMIT_IP_MAX
   */
  max: number;

  /**
   * Redis key prefix.  The final key is `<keyPrefix>:<identifier>`.
   */
  keyPrefix: string;

  /**
   * Human-readable message included in the 429 response body.
   */
  message: string;

  /**
   * When true, requests that result in a non-2xx response are NOT counted
   * towards the limit.  Useful for auth endpoints where failures should not
   * consume quota.
   * Default: false
   */
  skipFailedRequests: boolean;

  /**
   * When true, the rate-limiter adds X-RateLimit-* headers even on successful
   * responses so clients can track their remaining quota.
   * Default: true
   */
  standardHeaders: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Result returned by the Redis counter after a single increment. */
export interface RateLimitResult {
  /** Current request count within the active window */
  count: number;
  /** Remaining allowed requests before the limit is hit */
  remaining: number;
  /** Milliseconds until the window resets (TTL from Redis PTTL) */
  resetMs: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
  /** Whether the limit has been exceeded (count > max) */
  exceeded: boolean;
}
