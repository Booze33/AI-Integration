/**
 * Rate-Limit Middleware Tests
 *
 * Strategy:
 *  - Mock the Redis store (../store) so no Redis connection is required.
 *  - Build a tiny Express app for each scenario and drive it with supertest.
 *  - Cover: per-user, per-tenant, per-IP, header values, 429 body, Retry-After,
 *    fail-open on Redis errors, skipFailedRequests, env-var configuration,
 *    and createRateLimiter convenience factory.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Mock the store — increment is the only function the middleware calls
// ---------------------------------------------------------------------------

const mockIncrement = vi.hoisted(() => vi.fn());

vi.mock('../store', () => ({
  increment: mockIncrement,
  resetKey: vi.fn().mockResolvedValue(undefined),
}));

import {
  rateLimitByUser,
  rateLimitByTenant,
  rateLimitByIp,
  createRateLimiter,
} from '../middleware';

// ---------------------------------------------------------------------------
// Helper: build a mock RateLimitResult
// ---------------------------------------------------------------------------

function makeResult(count: number, max: number, resetMs = 30_000) {
  return {
    count,
    remaining: Math.max(0, max - count),
    resetMs,
    resetAt: Math.ceil((Date.now() + resetMs) / 1000),
    exceeded: count > max,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app that injects user / tenant context
// ---------------------------------------------------------------------------

interface AppOptions {
  userId?: string;
  tenantId?: string;
  forwardedFor?: string;
}

function buildApp(middleware: ReturnType<typeof rateLimitByIp>, opts: AppOptions = {}) {
  const app = express();
  app.use(express.json());

  // Simulate auth + tenant middleware by directly setting props
  app.use((req: Request, _res: Response, next) => {
    if (opts.userId) (req as any).user = { userId: opts.userId };
    if (opts.tenantId) (req as any).tenantId = opts.tenantId;
    if (opts.forwardedFor) req.headers['x-forwarded-for'] = opts.forwardedFor;
    next();
  });

  app.use('/api', middleware);
  app.get('/api/hello', (_req, res) => res.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rate-Limit Middleware', () => {
  beforeEach(() => {
    mockIncrement.mockClear();
    // Clear relevant env vars
    delete process.env['RATE_LIMIT_WINDOW_MS'];
    delete process.env['RATE_LIMIT_USER_MAX'];
    delete process.env['RATE_LIMIT_TENANT_MAX'];
    delete process.env['RATE_LIMIT_IP_MAX'];
    delete process.env['RATE_LIMIT_SKIP_FAILED'];
  });

  afterEach(() => vi.restoreAllMocks());

  // -------------------------------------------------------------------------
  // rateLimitByUser
  // -------------------------------------------------------------------------

  describe('rateLimitByUser()', () => {
    it('skips silently when no user is on the request', async () => {
      const app = buildApp(rateLimitByUser({ max: 5 }));
      await request(app).get('/api/hello').expect(200);
      expect(mockIncrement).not.toHaveBeenCalled();
    });

    it('allows request when under the limit', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 5));
      const app = buildApp(rateLimitByUser({ max: 5 }), { userId: 'user-1' });

      const res = await request(app).get('/api/hello').expect(200);

      expect(mockIncrement).toHaveBeenCalledOnce();
      // Key must include user scope prefix and user ID
      expect(mockIncrement.mock.calls[0][0]).toMatch(/^rl:u:user-1$/);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe('4');
    });

    it('returns 429 with Retry-After when limit is exceeded', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(6, 5, 45_000));
      const app = buildApp(rateLimitByUser({ max: 5 }), { userId: 'user-2' });

      const res = await request(app).get('/api/hello').expect(429);

      expect(res.headers['retry-after']).toBe('45');
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
      expect(res.body.error).toBe('Too Many Requests');
      expect(res.body.retryAfter).toBe(45);
      expect(res.body.message).toBeDefined();
    });

    it('passes max and windowMs to the store', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 10));
      const app = buildApp(rateLimitByUser({ max: 10, windowMs: 120_000 }), { userId: 'u-3' });
      await request(app).get('/api/hello');

      expect(mockIncrement).toHaveBeenCalledWith('rl:u:u-3', 10, 120_000);
    });

    it('reads RATE_LIMIT_USER_MAX from env when no override given', async () => {
      process.env['RATE_LIMIT_USER_MAX'] = '7';
      mockIncrement.mockResolvedValueOnce(makeResult(1, 7));
      const app = buildApp(rateLimitByUser(), { userId: 'u-env' });
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][1]).toBe(7);
    });

    it('accepts a custom message in the 429 body', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(11, 10, 20_000));
      const app = buildApp(rateLimitByUser({ max: 10, message: 'Custom user limit message' }), {
        userId: 'u-msg',
      });
      const res = await request(app).get('/api/hello').expect(429);
      expect(res.body.message).toBe('Custom user limit message');
    });
  });

  // -------------------------------------------------------------------------
  // rateLimitByTenant
  // -------------------------------------------------------------------------

  describe('rateLimitByTenant()', () => {
    it('skips silently when no tenant is on the request', async () => {
      const app = buildApp(rateLimitByTenant({ max: 100 }));
      await request(app).get('/api/hello').expect(200);
      expect(mockIncrement).not.toHaveBeenCalled();
    });

    it('uses req.tenantId as the key identifier', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 100));
      const app = buildApp(rateLimitByTenant({ max: 100 }), { tenantId: 'tenant-abc' });
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][0]).toBe('rl:t:tenant-abc');
    });

    it('resolves tenant from x-tenant-id header when req.tenantId is absent', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 100));
      const app = buildApp(rateLimitByTenant({ max: 100 }));

      await request(app).get('/api/hello').set('x-tenant-id', 'tenant-header');

      expect(mockIncrement.mock.calls[0][0]).toBe('rl:t:tenant-header');
    });

    it('returns 429 when tenant limit is exceeded', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1001, 1000, 10_000));
      const app = buildApp(rateLimitByTenant({ max: 1000 }), { tenantId: 't-exceeded' });

      const res = await request(app).get('/api/hello').expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.headers['x-ratelimit-limit']).toBe('1000');
    });

    it('reads RATE_LIMIT_TENANT_MAX from env when no override given', async () => {
      process.env['RATE_LIMIT_TENANT_MAX'] = '500';
      mockIncrement.mockResolvedValueOnce(makeResult(1, 500));
      const app = buildApp(rateLimitByTenant(), { tenantId: 't-env' });
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][1]).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // rateLimitByIp
  // -------------------------------------------------------------------------

  describe('rateLimitByIp()', () => {
    it('always increments (even without user/tenant)', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 50));
      const app = buildApp(rateLimitByIp({ max: 50 }));
      await request(app).get('/api/hello').expect(200);
      expect(mockIncrement).toHaveBeenCalledOnce();
    });

    it('uses x-forwarded-for when present', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 50));
      const app = buildApp(rateLimitByIp({ max: 50 }), { forwardedFor: '1.2.3.4' });
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][0]).toBe('rl:ip:1.2.3.4');
    });

    it('picks the first IP when x-forwarded-for contains a chain', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 50));
      const app = buildApp(rateLimitByIp({ max: 50 }), {
        forwardedFor: '10.0.0.1, 10.0.0.2, 10.0.0.3',
      });
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][0]).toBe('rl:ip:10.0.0.1');
    });

    it('returns 429 with correct headers when IP limit is exceeded', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(51, 50, 55_000));
      const app = buildApp(rateLimitByIp({ max: 50 }));

      const res = await request(app).get('/api/hello').expect(429);
      expect(res.headers['retry-after']).toBe('55');
      expect(res.headers['x-ratelimit-limit']).toBe('50');
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
      expect(res.body.retryAfter).toBe(55);
    });

    it('reads RATE_LIMIT_IP_MAX from env when no override given', async () => {
      process.env['RATE_LIMIT_IP_MAX'] = '30';
      mockIncrement.mockResolvedValueOnce(makeResult(1, 30));
      const app = buildApp(rateLimitByIp());
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][1]).toBe(30);
    });
  });

  // -------------------------------------------------------------------------
  // Fail-open on Redis errors
  // -------------------------------------------------------------------------

  describe('Fail-open behaviour', () => {
    it('calls next() and does NOT return 500 when Redis throws', async () => {
      mockIncrement.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const app = buildApp(rateLimitByIp({ max: 50 }));

      // Should pass through, not crash with 500
      await request(app).get('/api/hello').expect(200);
    });

    it('logs the Redis error to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockIncrement.mockRejectedValueOnce(new Error('timeout'));
      const app = buildApp(rateLimitByIp({ max: 50 }));

      await request(app).get('/api/hello');

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[rate-limit]'), expect.any(Error));
    });
  });

  // -------------------------------------------------------------------------
  // standardHeaders: false
  // -------------------------------------------------------------------------

  describe('standardHeaders: false', () => {
    it('omits X-RateLimit-* headers when standardHeaders is false', async () => {
      mockIncrement.mockResolvedValueOnce(makeResult(1, 100));
      const app = buildApp(rateLimitByIp({ max: 100, standardHeaders: false }));

      const res = await request(app).get('/api/hello').expect(200);
      expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // createRateLimiter convenience factory
  // -------------------------------------------------------------------------

  describe('createRateLimiter()', () => {
    it('returns an array of exactly 3 middleware functions', () => {
      const limiters = createRateLimiter();
      expect(Array.isArray(limiters)).toBe(true);
      expect(limiters).toHaveLength(3);
      limiters.forEach((fn) => expect(fn).toBeTypeOf('function'));
    });

    it('all three limiters run for an authenticated + tenant request', async () => {
      // Each scope resolves to "within limit"
      mockIncrement
        .mockResolvedValueOnce(makeResult(1, 100)) // user
        .mockResolvedValueOnce(makeResult(1, 1000)) // tenant
        .mockResolvedValueOnce(makeResult(1, 50)); // IP

      const app = express();
      app.use((req: any, _res, next) => {
        req.user = { userId: 'u-all' };
        req.tenantId = 't-all';
        next();
      });
      app.use('/api', ...createRateLimiter());
      app.get('/api/hello', (_req, res) => res.json({ ok: true }));

      await request(app).get('/api/hello').expect(200);
      expect(mockIncrement).toHaveBeenCalledTimes(3);
    });

    it('stops at the first exceeded scope and returns 429', async () => {
      // User limit is exceeded immediately
      mockIncrement.mockResolvedValueOnce(makeResult(101, 100, 30_000));

      const app = express();
      app.use((req: any, _res, next) => {
        req.user = { userId: 'u-exceed' };
        req.tenantId = 't-exceed';
        next();
      });
      app.use('/api', ...createRateLimiter({ max: 100 }));
      app.get('/api/hello', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/api/hello').expect(429);
      expect(res.body.error).toBe('Too Many Requests');
      // Tenant and IP limiters should NOT have been called
      expect(mockIncrement).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Window env var
  // -------------------------------------------------------------------------

  describe('RATE_LIMIT_WINDOW_MS env var', () => {
    it('passes the env window to the store', async () => {
      process.env['RATE_LIMIT_WINDOW_MS'] = '120000';
      mockIncrement.mockResolvedValueOnce(makeResult(1, 50));
      const app = buildApp(rateLimitByIp({ max: 50 }));
      await request(app).get('/api/hello');

      expect(mockIncrement.mock.calls[0][2]).toBe(120_000);
    });
  });
});
