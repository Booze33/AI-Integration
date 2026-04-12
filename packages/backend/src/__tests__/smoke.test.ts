import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

interface MockUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RateCounter {
  count: number;
  expiresAt: number;
}

const usersByTenantAndEmail = vi.hoisted(() => new Map<string, MockUser>());
const usersByTenantAndId = vi.hoisted(() => new Map<string, MockUser>());
const refreshTokenStore = vi.hoisted(() => new Map<string, string>());
const rateCounters = vi.hoisted(() => new Map<string, RateCounter>());
const streamStates = vi.hoisted(() => new Map<string, any>());

const mockChatStream = vi.hoisted(() =>
  vi.fn(async function* () {
    yield { id: 'chunk-1', delta: { content: 'Smoke test reply' }, model: 'mock-model' };
    yield { id: 'chunk-2', delta: { content: '.' }, model: 'mock-model', finishReason: 'stop' };
  })
);

const mockPipelineService = vi.hoisted(() => ({
  getUploadMiddleware: vi.fn(() => ({
    single: vi.fn(() => (req: any, _res: any, next: any) => {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        req.file = {
          fieldname: 'file',
          originalname: 'tiny.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          destination: './uploads',
          filename: 'tiny.pdf',
          path: './uploads/tiny.pdf',
          size: 128,
        };
      }
      next();
    }),
  })),
  processFileSync: vi.fn(async () => ({
    uploadedFile: {
      id: 'file-smoke-1',
      originalName: 'tiny.pdf',
      mimeType: 'application/pdf',
      size: 128,
    },
    extraction: { text: 'smoke text', pageCount: 1 },
    chunks: [{ tokenCount: 3 }],
  })),
  processFileAsync: vi.fn(async () => ({
    id: 'job-smoke-1',
    fileId: 'file-smoke-1',
    status: 'pending',
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getJobStatus: vi.fn(() => null),
  getAllJobs: vi.fn(() => []),
  getJobsByStatus: vi.fn(() => []),
  getQueueStats: vi.fn(async () => ({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  })),
}));

vi.mock('../database/tenant-context', () => {
  class MockTenantDatabase {
    static fromPool(_pool: unknown) {
      return new MockTenantDatabase();
    }

    async withTenant<T>(
      tenantId: string,
      callback: (client: {
        query: (
          text: string,
          params?: unknown[]
        ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
      }) => Promise<T>
    ): Promise<T> {
      const client = {
        query: async (text: string, params: unknown[] = []) => {
          const sql = text.toLowerCase();

          if (sql.includes('from auth.users') && sql.includes('where email = $1')) {
            const email = String(params[0]);
            const user = usersByTenantAndEmail.get(`${tenantId}:${email}`);
            return {
              rows: user
                ? [
                    {
                      id: user.id,
                      tenant_id: user.tenantId,
                      email: user.email,
                      password_hash: user.passwordHash,
                      created_at: user.createdAt,
                      updated_at: user.updatedAt,
                    },
                  ]
                : [],
              rowCount: user ? 1 : 0,
            };
          }

          if (sql.includes('from auth.users') && sql.includes('where id = $1')) {
            const userId = String(params[0]);
            const user = usersByTenantAndId.get(`${tenantId}:${userId}`);
            return {
              rows: user
                ? [
                    {
                      id: user.id,
                      tenant_id: user.tenantId,
                      email: user.email,
                      password_hash: user.passwordHash,
                      created_at: user.createdAt,
                      updated_at: user.updatedAt,
                    },
                  ]
                : [],
              rowCount: user ? 1 : 0,
            };
          }

          if (sql.includes('select role from auth.user_roles')) {
            const userId = String(params[0]);
            const user = usersByTenantAndId.get(`${tenantId}:${userId}`);
            return {
              rows: user ? [{ role: user.role }] : [],
              rowCount: user ? 1 : 0,
            };
          }

          if (sql.includes('insert into auth.users')) {
            const email = String(params[1]);
            const existing = usersByTenantAndEmail.get(`${tenantId}:${email}`);
            if (existing) {
              const duplicateError = { code: '23505' };
              throw duplicateError;
            }

            const newUser: MockUser = {
              id: `user-${usersByTenantAndId.size + 1}`,
              tenantId,
              email,
              passwordHash: String(params[2]),
              role: 'user',
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            usersByTenantAndEmail.set(`${tenantId}:${email}`, newUser);
            usersByTenantAndId.set(`${tenantId}:${newUser.id}`, newUser);

            return {
              rows: [
                {
                  id: newUser.id,
                  tenant_id: newUser.tenantId,
                  email: newUser.email,
                  password_hash: newUser.passwordHash,
                  created_at: newUser.createdAt,
                  updated_at: newUser.updatedAt,
                },
              ],
              rowCount: 1,
            };
          }

          if (sql.includes('insert into auth.user_roles')) {
            const userId = String(params[1]);
            const role = String(params[2]);
            const user = usersByTenantAndId.get(`${tenantId}:${userId}`);
            if (user) {
              user.role = role;
              usersByTenantAndEmail.set(`${tenantId}:${user.email}`, user);
              usersByTenantAndId.set(`${tenantId}:${user.id}`, user);
            }
            return { rows: [], rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
      };

      return callback(client);
    }
  }

  return { TenantDatabase: MockTenantDatabase };
});

vi.mock('../redis/client', () => ({
  storeRefreshToken: vi.fn(async (userId: string, tokenId: string) => {
    refreshTokenStore.set(tokenId, userId);
  }),
  verifyRefreshToken: vi.fn(async (tokenId: string) => refreshTokenStore.get(tokenId) ?? null),
  revokeRefreshToken: vi.fn(async (tokenId: string) => {
    refreshTokenStore.delete(tokenId);
  }),
  revokeAllUserTokens: vi.fn(async (userId: string) => {
    for (const [tokenId, storedUserId] of refreshTokenStore.entries()) {
      if (storedUserId === userId) {
        refreshTokenStore.delete(tokenId);
      }
    }
  }),
  getUserActiveTokens: vi.fn(async (userId: string) =>
    Array.from(refreshTokenStore.entries())
      .filter(([, storedUserId]) => storedUserId === userId)
      .map(([tokenId]) => tokenId)
  ),
  getRedisClient: vi.fn(async () => ({
    eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
      const key = options.keys[0];
      const windowMs = parseInt(options.arguments[0], 10);
      const now = Date.now();

      const current = rateCounters.get(key);
      if (!current || current.expiresAt <= now) {
        rateCounters.set(key, { count: 1, expiresAt: now + windowMs });
        return [1, windowMs];
      }

      current.count += 1;
      rateCounters.set(key, current);
      return [current.count, current.expiresAt - now];
    },
    del: async (key: string) => {
      rateCounters.delete(key);
      return 1;
    },
  })),
  closeRedisClient: vi.fn(async () => {}),
}));

vi.mock('../providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'mock-provider',
    chatStream: mockChatStream,
  })),
}));

vi.mock('../redis/stream-store', () => ({
  storeStreamState: vi.fn(async (streamState: any) => {
    streamStates.set(streamState.id, {
      ...streamState,
      chunks: streamState.chunks || [],
      finished: !!streamState.finished,
    });
  }),
  getStreamState: vi.fn(async (streamId: string) => streamStates.get(streamId) || null),
  deleteStreamState: vi.fn(async (streamId: string) => {
    streamStates.delete(streamId);
  }),
  addStreamChunk: vi.fn(async (streamId: string, chunk: string) => {
    const state = streamStates.get(streamId);
    if (state) {
      state.chunks.push(chunk);
      streamStates.set(streamId, state);
    }
  }),
  markStreamFinished: vi.fn(async (streamId: string) => {
    const state = streamStates.get(streamId);
    if (state) {
      state.finished = true;
      streamStates.set(streamId, state);
    }
  }),
  cleanupOldStreams: vi.fn(async () => {}),
}));

vi.mock('../pipeline/singleton', () => ({
  getPipelineService: vi.fn(() => mockPipelineService),
}));

function getTestPool() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  };
}

async function buildApp() {
  const { authRoutes, setAuthPool } = await import('../auth/routes.js');
  const { createChatRoutes } = await import('../chat/index.js');
  const { pipelineRoutes } = await import('../pipeline/index.js');
  const { createRateLimiter } = await import('../rate-limit/index.js');

  const app = express();
  app.use(express.json());

  setAuthPool({} as any);

  app.use('/auth', authRoutes);
  app.use('/api', createChatRoutes(getTestPool() as any));
  app.use('/api/pipeline', pipelineRoutes);
  app.use(
    '/api/rl-smoke',
    ...createRateLimiter(undefined, undefined, { max: 3, windowMs: 60_000 })
  );
  app.get('/api/rl-smoke/ping', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

async function registerAndLogin(app: express.Application, email: string, password: string) {
  const registerResponse = await request(app)
    .post('/auth/register')
    .send({ email, password, role: 'viewer' })
    .expect(201);

  expect(registerResponse.body.accessToken).toBeDefined();

  const loginResponse = await request(app)
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    accessToken: loginResponse.body.accessToken as string,
    refreshToken: loginResponse.body.refreshToken as string,
  };
}

describe('Smoke Tests', () => {
  let app: express.Application;

  beforeEach(async () => {
    usersByTenantAndEmail.clear();
    usersByTenantAndId.clear();
    refreshTokenStore.clear();
    rateCounters.clear();
    streamStates.clear();

    mockChatStream.mockClear();
    mockPipelineService.processFileAsync.mockClear();

    app = await buildApp();
  });

  it('auth flow: register -> login -> me -> logout', async () => {
    const email = 'smoke-auth@example.com';
    const password = 'StrongPass123!';

    const { accessToken, refreshToken } = await registerAndLogin(app, email, password);

    const meResponse = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meResponse.body.user.email).toBe(email);

    const logoutResponse = await request(app)
      .post('/auth/logout')
      .set('Cookie', [`refreshToken=${encodeURIComponent(refreshToken)}`])
      .expect(200);

    expect(logoutResponse.body.message).toContain('Logged out successfully');
  });

  it('chat endpoint: POST /api/chat streams mocked provider response', async () => {
    const { accessToken } = await registerAndLogin(app, 'smoke-chat@example.com', 'StrongPass123!');

    const response = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        messages: [{ role: 'user', content: 'Hello smoke test' }],
      })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: chunk');
    expect(response.text).toContain('event: done');
  });

  it('pipeline: upload tiny PDF and create async job', async () => {
    const { accessToken } = await registerAndLogin(
      app,
      'smoke-pipeline@example.com',
      'StrongPass123!'
    );

    const tinyPdf = Buffer.from('%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    const response = await request(app)
      .post('/api/pipeline/upload/async')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', tinyPdf, 'tiny.pdf')
      .expect(202);

    expect(response.body.success).toBe(true);
    expect(response.body.jobId).toBe('job-smoke-1');
  });

  it('rate limit: hammer endpoint returns 429', async () => {
    await request(app).get('/api/rl-smoke/ping').expect(200);
    await request(app).get('/api/rl-smoke/ping').expect(200);
    await request(app).get('/api/rl-smoke/ping').expect(200);

    const limited = await request(app).get('/api/rl-smoke/ping').expect(429);

    expect(limited.body.error).toBe('Too Many Requests');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
