/**
 * Integration Tests — All Endpoints
 *
 * Builds the complete Express application (same middleware stack as src/index.ts)
 * and drives every route via supertest.  External infrastructure is replaced by
 * fast, deterministic mocks so no real Redis, database, or AI API is required.
 *
 * Scenarios covered per requirement:
 *  ✓ Happy path
 *  ✓ Auth failure (missing / invalid token, wrong credentials)
 *  ✓ Rate-limit (429 + Retry-After)
 *  ✓ Upstream AI error (provider throws → SSE error event)
 *  ✓ DB/service error (Redis throws → 500)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// ① Redis client mock — keeps a tiny in-memory refresh-token store so that
//   register → refresh flows work end-to-end without a real Redis.
// ---------------------------------------------------------------------------

const mockTokenStore = vi.hoisted(() => new Map<string, string>()); // tokenId → userId

vi.mock('../redis/client', () => ({
  getRedisClient: vi.fn(),
  storeRefreshToken: vi.fn((userId: string, tokenId: string) => {
    mockTokenStore.set(tokenId, userId);
    return Promise.resolve();
  }),
  verifyRefreshToken: vi.fn((tokenId: string) =>
    Promise.resolve(mockTokenStore.get(tokenId) ?? null)
  ),
  revokeRefreshToken: vi.fn((tokenId: string) => {
    mockTokenStore.delete(tokenId);
    return Promise.resolve();
  }),
  revokeAllUserTokens: vi.fn(() => Promise.resolve()),
  getUserActiveTokens: vi.fn(() => Promise.resolve(['tok-a', 'tok-b'])),
  closeRedisClient: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// ② JWT mock — uses simple base-64 encoding instead of RSA keys so tests
//   don't need key files on disk.  verifyToken correctly decodes the payload,
//   enabling the authenticate middleware to work end-to-end.
// ---------------------------------------------------------------------------

vi.mock('../auth/jwt', () => {
  function encodeToken(payload: object): string {
    return 'MOCK.' + Buffer.from(JSON.stringify(payload)).toString('base64');
  }
  function decodeToken(token: string): object {
    if (!token.startsWith('MOCK.')) {
      const err = Object.assign(new Error('invalid signature'), {
        name: 'JsonWebTokenError',
      });
      throw err;
    }
    return JSON.parse(Buffer.from(token.slice(5), 'base64').toString('utf8'));
  }
  return {
    generateTokenPair: vi.fn((payload: object) => {
      const tokenId = 'mock-token-id';
      return {
        accessToken: encodeToken(payload),
        refreshToken: encodeToken({ ...(payload as any), tokenId }),
        tokenId,
      };
    }),
    verifyToken: vi.fn(decodeToken),
    generateAccessToken: vi.fn((payload: object) => encodeToken(payload)),
    generateRefreshToken: vi.fn((payload: object, tokenId: string) =>
      encodeToken({ ...(payload as any), tokenId })
    ),
  };
});

// ---------------------------------------------------------------------------
// ③ AI provider mock
// ---------------------------------------------------------------------------

const mockChatStream = vi.hoisted(() =>
  vi.fn(async function* () {
    yield { id: '1', delta: { content: 'Hello' }, model: 'mock' };
    yield { id: '2', delta: { content: ' world' }, model: 'mock', finishReason: 'stop' };
  })
);

vi.mock('../providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'mock',
    chatStream: mockChatStream,
  })),
}));

// ---------------------------------------------------------------------------
// ④ Rate-limit store mock (returns "within limit" by default)
// ---------------------------------------------------------------------------

const mockRlIncrement = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    count: 1,
    remaining: 99,
    resetMs: 60_000,
    resetAt: Math.ceil((Date.now() + 60_000) / 1000),
    exceeded: false,
  })
);

vi.mock('../rate-limit/store', () => ({
  increment: mockRlIncrement,
  resetKey: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// ⑤ Webhook queue mock
// ---------------------------------------------------------------------------

const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../webhook/queue', () => ({
  // Must use class/function syntax — arrow functions cannot be `new`-ed
  WebhookQueueService: class {
    enqueue = mockEnqueue;
  },
}));

// ---------------------------------------------------------------------------
// ⑥ Pipeline service mock
// ---------------------------------------------------------------------------

const mockPipelineOps = vi.hoisted(() => ({
  processFileSync: vi.fn().mockResolvedValue({
    uploadedFile: { id: 'file-1', originalName: 'test.txt', mimeType: 'text/plain', size: 100 },
    extraction: { text: 'hello world', pageCount: 1 },
    chunks: [{ content: 'hello', tokenCount: 5 }],
  }),
  processFileAsync: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
  getJobStatus: vi.fn().mockReturnValue(null),
  getAllJobs: vi.fn().mockReturnValue([]),
  getJobsByStatus: vi.fn().mockReturnValue([]),
  getQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
}));

vi.mock('../pipeline/pipeline', () => ({
  createPipelineService: vi.fn(() => ({
    getUploadMiddleware: vi.fn(() => ({
      single: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
    })),
    ...mockPipelineOps,
  })),
}));

// ---------------------------------------------------------------------------
// App factory — mirrors the middleware stack in src/index.ts
// ---------------------------------------------------------------------------

async function buildApp() {
  const { requestLogger } = await import('../logger/index.js');
  const { webhookRoutes } = await import('../webhook/index.js');
  const { createRateLimiter } = await import('../rate-limit/index.js');
  const { authRoutes, setAuthPool } = await import('../auth/routes.js');
  const { chatRoutes } = await import('../chat/index.js');
  const { pipelineRoutes } = await import('../pipeline/index.js');
  const { notFoundHandler, errorHandler } = await import('../errors/index.js');

  const app = express();
  const authPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/test',
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  setAuthPool(authPool);

  app.use(requestLogger({ write: () => {} })); // suppress log noise in tests
  app.use('/api', webhookRoutes);
  app.use(express.json());
  app.use('/api', ...createRateLimiter());
  app.use('/auth', authRoutes);
  app.use('/api', chatRoutes);
  app.use('/api/pipeline', pipelineRoutes);
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register + login; returns auth payload. */
async function registerUser(app: express.Application, email: string, password = 'Test1234!') {
  const res = await request(app).post('/auth/register').send({ email, password });
  return res.body as {
    accessToken: string;
    refreshToken: string;
    user: { tenantId?: string };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration Tests', () => {
  let app: express.Application;

  beforeEach(async () => {
    app = await buildApp();
    mockRlIncrement.mockResolvedValue({
      count: 1,
      remaining: 99,
      resetMs: 60_000,
      resetAt: Math.ceil((Date.now() + 60_000) / 1000),
      exceeded: false,
    });
    mockChatStream.mockImplementation(async function* () {
      yield { id: '1', delta: { content: 'Hello' }, model: 'mock' };
      yield { id: '2', delta: { content: '!' }, model: 'mock', finishReason: 'stop' };
    });
  });

  // =========================================================================
  // Health
  // =========================================================================

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('attaches X-Request-ID header', async () => {
      const res = await request(app).get('/health').expect(200);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('echoes client-supplied X-Request-ID', async () => {
      const res = await request(app).get('/health').set('x-request-id', 'custom-id').expect(200);
      expect(res.headers['x-request-id']).toBe('custom-id');
    });
  });

  // =========================================================================
  // Auth — POST /auth/register
  // =========================================================================

  describe('POST /auth/register', () => {
    it('happy path — registers user and returns tokens in the response body', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'reg-happy@test.com', password: 'Str0ngPass!' })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.user.email).toBe('reg-happy@test.com');
      expect(res.body.user.tenantId).toBeDefined();
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ password: 'Str0ngPass!' })
        .expect(400);

      expect(res.body.message).toContain('required');
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'Str0ngPass!' })
        .expect(400);

      expect(res.body.message).toContain('email');
    });

    it('returns 400 when password is too short', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'short-pw@test.com', password: 'abc' })
        .expect(400);

      expect(res.body.message).toContain('8');
    });

    it('returns 409 for duplicate email', async () => {
      const email = 'dup@test.com';
      await request(app).post('/auth/register').send({ email, password: 'Str0ngPass!' });
      const res = await request(app)
        .post('/auth/register')
        .send({ email, password: 'Str0ngPass!' })
        .expect(409);

      expect(res.body.message).toContain('already exists');
    });

    it('returns 500 when Redis (storeRefreshToken) throws', async () => {
      const { storeRefreshToken } = await import('../redis/client.js');
      (storeRefreshToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Redis connection refused')
      );

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'redis-fail@test.com', password: 'Str0ngPass!' })
        .expect(500);

      expect(res.body.message).toContain('register');
    });
  });

  // =========================================================================
  // Auth — POST /auth/login
  // =========================================================================

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await registerUser(app, 'login-user@test.com');
    });

    it('happy path — returns 200 and tokens', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'login-user@test.com', password: 'Test1234!' })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.message).toContain('successful');
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'login-user@test.com', password: 'WrongPass!' })
        .expect(401);

      expect(res.body.message).toContain('Invalid');
    });

    it('returns 401 for non-existent user', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'ghost@test.com', password: 'Test1234!' })
        .expect(401);

      expect(res.body.message).toContain('Invalid');
    });

    it('returns 400 when credentials are missing', async () => {
      const res = await request(app).post('/auth/login').send({}).expect(400);
      expect(res.body.message).toContain('required');
    });
  });

  // =========================================================================
  // Auth — GET /auth/me
  // =========================================================================

  describe('GET /auth/me', () => {
    it('happy path — returns user info with valid token', async () => {
      await registerUser(app, 'me-user@test.com');
      const { accessToken } = await registerUser(app, 'me-user2@test.com');

      // use the second user's token
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.user.email).toBe('me-user2@test.com');
    });

    it('auth failure — returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/auth/me').expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('auth failure — returns 401 for invalid token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer this.is.not.valid')
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('auth failure — returns 401 for malformed Authorization header', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Token abc123')
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });
  });

  // =========================================================================
  // Auth — POST /auth/refresh
  // =========================================================================

  describe('POST /auth/refresh', () => {
    it('happy path — issues new token pair with valid refresh token', async () => {
      const { refreshToken } = await registerUser(app, 'refresh-user@test.com');

      const res = await request(app).post('/auth/refresh').send({ refreshToken }).expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.message).toContain('refreshed');
    });

    it('returns 400 when refreshToken is missing', async () => {
      await request(app).post('/auth/refresh').send({}).expect(400);
    });

    it('returns 401 for an invalid refresh token', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'INVALID.BAD.TOKEN' })
        .expect(401);

      expect(res.body.message).toContain('Invalid');
    });
  });

  // =========================================================================
  // Auth — POST /auth/logout
  // =========================================================================

  describe('POST /auth/logout', () => {
    it('happy path — returns 200 regardless of token validity', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .send({ refreshToken: 'anything' })
        .expect(200);

      expect(res.body.message).toContain('Logged out');
    });

    it('returns 200 even without a refresh token', async () => {
      const res = await request(app).post('/auth/logout').send({}).expect(200);
      expect(res.body.message).toContain('Logged out');
    });
  });

  // =========================================================================
  // Chat — GET /api/chat/health
  // =========================================================================

  describe('GET /api/chat/health', () => {
    it('returns 200 with service status', async () => {
      const res = await request(app).get('/api/chat/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('chat');
    });
  });

  // =========================================================================
  // Chat — POST /api/chat
  // =========================================================================

  describe('POST /api/chat', () => {
    const VALID_MESSAGES = [{ role: 'user', content: 'Hello' }];

    it('happy path — returns 200 with text/event-stream content type', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ messages: VALID_MESSAGES })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('happy path — SSE body contains start and done events', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ messages: VALID_MESSAGES })
        .expect(200);

      const body = res.text;
      expect(body).toContain('event: start');
      expect(body).toContain('event: done');
      expect(body).toContain('event: chunk');
    });

    it('returns 400 for empty messages array', async () => {
      const res = await request(app).post('/api/chat').send({ messages: [] }).expect(400);

      expect(res.body.error).toBe('Invalid request');
    });

    it('returns 400 when messages field is absent', async () => {
      const res = await request(app).post('/api/chat').send({}).expect(400);
      expect(res.body.message).toContain('required');
    });

    it('returns 400 for invalid message role', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'hacker', content: 'x' }] })
        .expect(400);

      expect(res.body.error).toContain('role');
    });

    it('upstream AI error — sends SSE error event instead of crashing', async () => {
      // eslint-disable-next-line require-yield
      mockChatStream.mockImplementationOnce(async function* () {
        throw new Error('OpenAI API timeout');
      });

      const res = await request(app)
        .post('/api/chat')
        .send({ messages: VALID_MESSAGES })
        .expect(200);

      expect(res.text).toContain('event: error');
      expect(res.text).toContain('OpenAI API timeout');
    });
  });

  // =========================================================================
  // Pipeline — GET /api/pipeline/jobs
  // =========================================================================

  describe('GET /api/pipeline/jobs', () => {
    it('happy path — returns empty jobs list', async () => {
      const res = await request(app).get('/api/pipeline/jobs').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobs).toEqual([]);
    });

    it('returns filtered jobs when status query param is provided', async () => {
      mockPipelineOps.getJobsByStatus.mockReturnValueOnce([
        {
          id: 'j1',
          status: 'completed',
          fileId: 'f1',
          progress: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app).get('/api/pipeline/jobs?status=completed').expect(200);

      expect(res.body.jobs.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Pipeline — GET /api/pipeline/jobs/:jobId
  // =========================================================================

  describe('GET /api/pipeline/jobs/:jobId', () => {
    it('returns 404 for unknown job ID', async () => {
      const res = await request(app).get('/api/pipeline/jobs/nonexistent').expect(404);
      expect(res.body.error).toContain('not found');
    });

    it('happy path — returns job details when job exists', async () => {
      mockPipelineOps.getJobStatus.mockReturnValueOnce({
        id: 'job-123',
        fileId: 'file-abc',
        status: 'completed',
        progress: 100,
        chunks: [{ content: 'text', tokenCount: 10 }],
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      });

      const res = await request(app).get('/api/pipeline/jobs/job-123').expect(200);
      expect(res.body.job.id).toBe('job-123');
      expect(res.body.job.status).toBe('completed');
    });
  });

  // =========================================================================
  // Pipeline — GET /api/pipeline/stats
  // =========================================================================

  describe('GET /api/pipeline/stats', () => {
    it('happy path — returns queue statistics', async () => {
      const res = await request(app).get('/api/pipeline/stats').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
    });

    it('DB/service error — returns 500 when getQueueStats throws', async () => {
      mockPipelineOps.getQueueStats.mockRejectedValueOnce(new Error('Redis connection lost'));

      const res = await request(app).get('/api/pipeline/stats').expect(500);
      expect(res.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // Pipeline — POST /api/pipeline/upload (no-file validation only;
  //   real multipart is tested in pipeline unit tests)
  // =========================================================================

  describe('POST /api/pipeline/upload', () => {
    it('returns 400 when no file is attached', async () => {
      const res = await request(app).post('/api/pipeline/upload').expect(400);
      expect(res.body.error).toContain('No file');
    });
  });

  describe('POST /api/pipeline/upload/async', () => {
    it('returns 400 when no file is attached', async () => {
      const res = await request(app).post('/api/pipeline/upload/async').expect(400);
      expect(res.body.error).toContain('No file');
    });
  });

  // =========================================================================
  // Pipeline — DELETE /api/pipeline/jobs/:jobId
  // =========================================================================

  describe('DELETE /api/pipeline/jobs/:jobId', () => {
    it('returns 404 for unknown job', async () => {
      const res = await request(app).delete('/api/pipeline/jobs/ghost').expect(404);
      expect(res.body.error).toContain('not found');
    });

    it('happy path — returns 200 when job exists', async () => {
      mockPipelineOps.getJobStatus.mockReturnValueOnce({
        id: 'del-job',
        fileId: 'f',
        status: 'completed',
        progress: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).delete('/api/pipeline/jobs/del-job').expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // Webhook — GET /api/webhooks/health
  // =========================================================================

  describe('GET /api/webhooks/health', () => {
    it('returns 200 with supported providers list', async () => {
      const res = await request(app).get('/api/webhooks/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(Array.isArray(res.body.providers)).toBe(true);
    });
  });

  // =========================================================================
  // Webhook — POST /api/webhooks/:provider
  // =========================================================================

  describe('POST /api/webhooks/github', () => {
    it('happy path — returns 200 and enqueues job when no secret is configured', async () => {
      const savedSecret = process.env['GITHUB_WEBHOOK_SECRET'];
      delete process.env['GITHUB_WEBHOOK_SECRET'];

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('content-type', 'application/json')
        .set('x-github-event', 'push')
        .send(JSON.stringify({ ref: 'refs/heads/main' }))
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(mockEnqueue).toHaveBeenCalledOnce();

      process.env['GITHUB_WEBHOOK_SECRET'] = savedSecret;
    });

    it('auth failure — returns 401 when signature is missing but secret is configured', async () => {
      process.env['GITHUB_WEBHOOK_SECRET'] = 'test-secret';

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('content-type', 'application/json')
        .send(JSON.stringify({ ref: 'refs/heads/main' }))
        .expect(401);

      expect(res.body.error).toBeDefined();

      delete process.env['GITHUB_WEBHOOK_SECRET'];
    });

    it('auth failure — returns 401 for tampered payload', async () => {
      const secret = 'test-secret';
      process.env['GITHUB_WEBHOOK_SECRET'] = secret;

      const payload = JSON.stringify({ ref: 'refs/heads/main' });
      const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('content-type', 'application/json')
        .set('x-hub-signature-256', `sha256=${validSig}bad`)
        .send(payload)
        .expect(401);

      expect(res.body.error).toBeDefined();

      delete process.env['GITHUB_WEBHOOK_SECRET'];
    });

    it('returns 400 for an unsupported provider', async () => {
      const res = await request(app).post('/api/webhooks/unknown-provider').send({}).expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // Cross-cutting — 404 unknown routes
  // =========================================================================

  describe('Unknown route → 404', () => {
    it('returns 404 JSON for a completely unknown path', async () => {
      const res = await request(app).get('/api/does-not-exist').expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.statusCode).toBe(404);
    });

    it('correlationId from X-Request-ID appears in 404 body', async () => {
      const res = await request(app).get('/nowhere').set('x-request-id', 'trace-404').expect(404);

      expect(res.body.correlationId).toBe('trace-404');
    });
  });

  // =========================================================================
  // Cross-cutting — Rate limiting (429)
  // =========================================================================

  describe('Rate-limit → 429', () => {
    // Only the IP scope fires for unauthenticated requests (user/tenant scopes
    // are skipped when req.user and req.tenantId are not set), so increment is
    // called exactly ONCE per unauthenticated request.

    it('returns 429 with Retry-After header when IP limit is exceeded', async () => {
      mockRlIncrement.mockResolvedValueOnce({
        count: 51,
        remaining: 0,
        resetMs: 30_000,
        resetAt: 9999,
        exceeded: true,
      });

      const res = await request(app).get('/api/chat/health').expect(429);

      expect(res.headers['retry-after']).toBeDefined();
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body.error).toBe('Too Many Requests');
      expect(res.body.retryAfter).toBeDefined();
    });

    it('Retry-After value equals ceil(resetMs / 1000)', async () => {
      mockRlIncrement.mockResolvedValueOnce({
        count: 51,
        remaining: 0,
        resetMs: 45_000,
        resetAt: 9999,
        exceeded: true,
      });

      const res = await request(app).get('/api/chat/health').expect(429);
      expect(res.body.retryAfter).toBe(45);
    });
  });

  // =========================================================================
  // Cross-cutting — Correlation ID flows through errors
  // =========================================================================

  describe('Correlation ID in error responses', () => {
    it('X-Request-ID header is always present on error responses', async () => {
      const res = await request(app).get('/api/not-a-route').expect(404);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('error body contains correlationId matching X-Request-ID', async () => {
      const res = await request(app)
        .get('/unknown-route')
        .set('x-request-id', 'my-trace')
        .expect(404);

      expect(res.body.correlationId).toBe('my-trace');
      expect(res.headers['x-request-id']).toBe('my-trace');
    });
  });
});
