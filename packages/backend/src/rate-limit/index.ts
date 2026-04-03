/**
 * Rate-Limit Module
 *
 * Redis-backed, fixed-window rate limiting with per-user, per-tenant, and
 * per-IP scopes.  All limits are configurable via environment variables.
 *
 * Quick start — apply to all /api routes in src/index.ts:
 *
 *   import { createRateLimiter } from './rate-limit';
 *   app.use('/api', ...createRateLimiter());
 *
 * Individual factories — useful when you need different limits per route:
 *
 *   import { rateLimitByUser, rateLimitByTenant, rateLimitByIp } from './rate-limit';
 *
 *   router.post('/expensive', rateLimitByUser({ max: 10 }), handler);
 */

export { rateLimitByUser, rateLimitByTenant, rateLimitByIp, createRateLimiter } from './middleware';

export { increment, resetKey } from './store';

export type { RateLimitConfig, RateLimitResult } from './types';
