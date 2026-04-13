/**
 * Rate-Limit Middleware
 *
 * Provides three composable middleware factories:
 *
 *   rateLimitByUser(overrides?)   — keyed on req.user.sub (JWT subject)
 *   rateLimitByTenant(overrides?) — keyed on req.tenantId or x-tenant-id header
 *   rateLimitByIp(overrides?)     — keyed on remote IP (always applies)
 *
 * Each factory:
 *  • Skips silently when the relevant identifier is absent on the request.
 *  • Sets X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset headers.
 *  • Returns 429 with a Retry-After header (seconds) when the limit is exceeded.
 *  • Falls back gracefully to `next()` when Redis is unavailable (fail-open).
 *
 * Convenience:
 *
 *   createRateLimiter(overrides?) — returns [rateLimitByUser, rateLimitByTenant,
 *                                             rateLimitByIp] as a single array,
 *                                   ready for app.use().
 *
 * Environment variables (all optional, with defaults shown):
 *   RATE_LIMIT_WINDOW_MS=60000    window length in ms   (1 minute)
 *   RATE_LIMIT_USER_MAX=100       max requests per user per window
 *   RATE_LIMIT_TENANT_MAX=1000    max requests per tenant per window
 *   RATE_LIMIT_IP_MAX=50          max requests per IP per window
 *   RATE_LIMIT_SKIP_FAILED=false  skip non-2xx responses
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth/middleware';
import { increment } from './store';
import { RateLimitConfig, RateLimitResult } from './types';

// ---------------------------------------------------------------------------
// Env-driven defaults
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  return v.toLowerCase() === 'true';
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) continue;
    const key = decodeURIComponent(rawKey.trim());
    const value = decodeURIComponent((rawValue || []).join('=').trim());
    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

const DEFAULT_WINDOW_MS = () => envInt('RATE_LIMIT_WINDOW_MS', 60_000);
const DEFAULT_USER_MAX = () => envInt('RATE_LIMIT_USER_MAX', 100);
const DEFAULT_TENANT_MAX = () => envInt('RATE_LIMIT_TENANT_MAX', 1_000);
const DEFAULT_IP_MAX = () => envInt('RATE_LIMIT_IP_MAX', 50);
const DEFAULT_SKIP_FAILED = () => envBool('RATE_LIMIT_SKIP_FAILED', false);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve the caller's real IP, honoring common proxy headers. */
function resolveIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

function hasAuthenticatedIdentity(req: Request): boolean {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.userId) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return true;
  }

  const cookies = parseCookies(req.headers.cookie);
  return Boolean(cookies.accessToken || cookies.refreshToken);
}

/** Write standard rate-limit response headers. */
function setHeaders(res: Response, config: RateLimitConfig, result: RateLimitResult): void {
  if (!config.standardHeaders) return;
  res.setHeader('X-RateLimit-Limit', config.max);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', result.resetAt);
}

/** Send a 429 response with Retry-After header and JSON body. */
function sendTooManyRequests(res: Response, result: RateLimitResult, message: string): void {
  const retryAfter = Math.ceil(result.resetMs / 1000);
  res.setHeader('Retry-After', retryAfter);
  res.status(429).json({
    error: 'Too Many Requests',
    message,
    retryAfter,
  });
}

/**
 * Core rate-limit logic shared by all three factories.
 *
 * Builds the Redis key, increments the counter, sets headers, and either
 * calls `next()` or returns 429.  All Redis errors are caught and cause
 * the middleware to fail-open (call `next()`) so a Redis outage never
 * blocks legitimate traffic.
 */
async function applyLimit(
  key: string,
  config: RateLimitConfig,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let result: RateLimitResult;

  try {
    result = await increment(key, config.max, config.windowMs);
  } catch (err) {
    // Fail-open: Redis is unavailable, let the request through
    console.error('[rate-limit] Redis error (fail-open):', err);
    return next();
  }

  setHeaders(res, config, result);

  if (!result.exceeded) {
    if (config.skipFailedRequests) {
      // Decrement on non-2xx by hooking into res.end
      const originalEnd = res.end.bind(res) as typeof res.end;
      res.end = ((...args: Parameters<typeof res.end>) => {
        if (res.statusCode >= 400) {
          // Best-effort decrement — fire-and-forget
          increment(key, config.max, config.windowMs).catch(() => {});
        }
        return originalEnd(...args);
      }) as typeof res.end;
    }
    return next();
  }

  sendTooManyRequests(res, result, config.message);
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

type PartialConfig = Partial<Omit<RateLimitConfig, 'keyPrefix'>>;

/**
 * Rate-limit by authenticated user ID (JWT `userId` claim).
 * Silently skips if `req.user` is not populated (i.e. unauthenticated route).
 */
export function rateLimitByUser(overrides?: PartialConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // req.user is attached by the auth middleware — cast to access it
    const userId = (req as AuthenticatedRequest).user?.userId;
    if (!userId) return next(); // not authenticated yet — skip

    const config: RateLimitConfig = {
      windowMs: DEFAULT_WINDOW_MS(),
      max: DEFAULT_USER_MAX(),
      keyPrefix: 'rl:u',
      message: 'Too many requests from this user. Please slow down.',
      skipFailedRequests: DEFAULT_SKIP_FAILED(),
      standardHeaders: true,
      ...overrides,
    };

    await applyLimit(`${config.keyPrefix}:${userId}`, config, req, res, next);
  };
}

/**
 * Rate-limit by tenant ID.
 *
 * Resolves tenant from (in priority order):
 *   1. `req.tenantId` (set by `requireTenant` middleware)
 *   2. `x-tenant-id` request header
 *
 * Silently skips if no tenant ID can be found.
 */
export function rateLimitByTenant(overrides?: PartialConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantId =
      (req as Request & { tenantId?: string }).tenantId ||
      (req.headers['x-tenant-id'] as string | undefined);

    if (!tenantId) return next(); // no tenant context — skip

    const config: RateLimitConfig = {
      windowMs: DEFAULT_WINDOW_MS(),
      max: DEFAULT_TENANT_MAX(),
      keyPrefix: 'rl:t',
      message: 'Tenant rate limit exceeded. Please reduce request frequency.',
      skipFailedRequests: DEFAULT_SKIP_FAILED(),
      standardHeaders: true,
      ...overrides,
    };

    await applyLimit(`${config.keyPrefix}:${tenantId}`, config, req, res, next);
  };
}

/**
 * Rate-limit by remote IP address.
 * Always applies — use as the last line of defence for unauthenticated traffic.
 */
export function rateLimitByIp(overrides?: PartialConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (hasAuthenticatedIdentity(req)) {
      return next();
    }

    const ip = resolveIp(req);

    const config: RateLimitConfig = {
      windowMs: DEFAULT_WINDOW_MS(),
      max: DEFAULT_IP_MAX(),
      keyPrefix: 'rl:ip',
      message: 'Too many requests from this IP address. Please slow down.',
      skipFailedRequests: DEFAULT_SKIP_FAILED(),
      standardHeaders: true,
      ...overrides,
    };

    await applyLimit(`${config.keyPrefix}:${ip}`, config, req, res, next);
  };
}

// ---------------------------------------------------------------------------
// Convenience: combined limiter array
// ---------------------------------------------------------------------------

/**
 * Returns an array of three middleware functions — user, tenant, IP — in the
 * correct application order.  Spread it into `app.use()`:
 *
 *   app.use('/api', ...createRateLimiter());
 *
 * Each scope is evaluated independently.  A request from an authenticated
 * user inside a tenant goes through both the per-user AND per-tenant checks.
 *
 * @param userOverrides   Config overrides for the user limiter
 * @param tenantOverrides Config overrides for the tenant limiter
 * @param ipOverrides     Config overrides for the IP limiter
 */
export function createRateLimiter(
  userOverrides?: PartialConfig,
  tenantOverrides?: PartialConfig,
  ipOverrides?: PartialConfig
): [RequestHandler, RequestHandler, RequestHandler] {
  return [
    rateLimitByUser(userOverrides),
    rateLimitByTenant(tenantOverrides),
    rateLimitByIp(ipOverrides),
  ];
}
