/**
 * Cap Enforcement Tests
 *
 * Verifies that per-tenant token cap enforcement produces the correct 429
 * response on both the HTTP SSE path (POST /api/chat) and the WebSocket path
 * (/ws/chat).  All external dependencies are mocked — no live DB / Redis /
 * AI provider required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import type { Pool } from 'pg';
import { createChatRoutes } from '../index';
import { registerChatWebSocket } from '../websocket';

// ---------------------------------------------------------------------------
// Auth middleware mock — injects a tenant-bearing user for HTTP routes.
// ---------------------------------------------------------------------------
vi.mock('../../auth/middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      userId: 'user-1',
      email: 'test@example.com',
      role: 'member',
      tenantId: 'tenant-1',
    };
    next();
  },
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// JWT mock — used by WebSocket auth (verifyToken is called directly, not via
// Express middleware).
// ---------------------------------------------------------------------------
vi.mock('../../auth/jwt', () => ({
  verifyToken: vi.fn(() => ({
    userId: 'user-1',
    email: 'test@example.com',
    role: 'member',
    tenantId: 'tenant-1',
  })),
}));

// ---------------------------------------------------------------------------
// Redis stream-store mock — in-memory, avoids real Redis.
// ---------------------------------------------------------------------------
const streamCache = new Map<string, any>();
vi.mock('../../redis/stream-store', () => ({
  storeStreamState: vi.fn(async (state: any) => {
    streamCache.set(state.id, state);
  }),
  getStreamState: vi.fn(async (id: string) => streamCache.get(id) || null),
  deleteStreamState: vi.fn(async (id: string) => {
    streamCache.delete(id);
  }),
  addStreamChunk: vi.fn(async () => {}),
  markStreamFinished: vi.fn(async () => {}),
  cleanupOldStreams: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Provider mock — yields a single chunk so the allowed path completes.
// ---------------------------------------------------------------------------
const mockChatStream = vi.fn(async function* () {
  yield {
    id: 'chunk-1',
    delta: { content: 'Hello' },
    model: 'mock-model',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
});

vi.mock('../../providers', () => ({
  getProvider: () => ({
    name: 'mock',
    supportedModels: ['mock-model'],
    chatStream: mockChatStream,
    createRealtimeSession: undefined,
  }),
}));

// ---------------------------------------------------------------------------
// Audit mock — prevents DB writes during tests.
// ---------------------------------------------------------------------------
vi.mock('../../audit', () => ({
  logAudit: vi.fn(async () => {}),
  // AuditService must be constructable (new AuditService(pool) in websocket.ts).
  AuditService: class MockAuditService {
    constructor() {}
  },
}));

// ---------------------------------------------------------------------------
// UsageCapsService mock — the key controlled variable.
// ---------------------------------------------------------------------------
const mockCheckAllowance = vi.fn();
const mockRecordUsage = vi.fn(async () => {});

vi.mock('../../usage-caps', () => ({
  UsageCapsService: {
    fromPool: vi.fn(() => ({
      checkAllowance: mockCheckAllowance,
      recordUsage: mockRecordUsage,
    })),
  },
  estimateMessagesTokens: vi.fn(() => 100),
  estimateTextTokens: vi.fn(() => 50),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function createMockPool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as Pool;
}

const VALID_MESSAGES = [{ role: 'user' as const, content: 'Hello' }];

const ALLOWANCE_ALLOWED = {
  allowed: true as const,
  dailyCapTokens: 10_000,
  monthlyCapTokens: 100_000,
  dailyUsedTokens: 500,
  monthlyUsedTokens: 2000,
  estimatedRequestTokens: 1124,
  retryAtUtc: null,
};

const DAILY_CAP_EXCEEDED = {
  allowed: false as const,
  reasonCode: 'TENANT_TOKEN_DAILY_CAP_EXCEEDED' as const,
  dailyCapTokens: 1000,
  monthlyCapTokens: 10_000,
  dailyUsedTokens: 950,
  monthlyUsedTokens: 1500,
  estimatedRequestTokens: 1124,
  retryAtUtc: '2026-05-01T00:00:00.000Z',
};

const MONTHLY_CAP_EXCEEDED = {
  allowed: false as const,
  reasonCode: 'TENANT_TOKEN_MONTHLY_CAP_EXCEEDED' as const,
  dailyCapTokens: 10_000,
  monthlyCapTokens: 10_000,
  dailyUsedTokens: 100,
  monthlyUsedTokens: 9999,
  estimatedRequestTokens: 1124,
  retryAtUtc: '2026-06-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// HTTP SSE tests
// ---------------------------------------------------------------------------

describe('Cap enforcement — HTTP SSE (POST /api/chat)', () => {
  let app: express.Application;

  beforeEach(() => {
    streamCache.clear();
    mockChatStream.mockClear();
    mockRecordUsage.mockClear();

    app = express();
    app.use(express.json());
    app.use('/api', createChatRoutes(createMockPool()));
  });

  it('returns 429 with daily cap reason when daily cap is exceeded', async () => {
    mockCheckAllowance.mockResolvedValue(DAILY_CAP_EXCEEDED);

    const response = await request(app)
      .post('/api/chat')
      .send({ messages: VALID_MESSAGES })
      .expect(429);

    expect(response.body).toMatchObject({
      error: 'Tenant token cap exceeded',
      code: 'TENANT_TOKEN_DAILY_CAP_EXCEEDED',
      dailyUsedTokens: 950,
      dailyCapTokens: 1000,
      retryAtUtc: '2026-05-01T00:00:00.000Z',
    });
  });

  it('returns 429 with monthly cap reason when monthly cap is exceeded', async () => {
    mockCheckAllowance.mockResolvedValue(MONTHLY_CAP_EXCEEDED);

    const response = await request(app)
      .post('/api/chat')
      .send({ messages: VALID_MESSAGES })
      .expect(429);

    expect(response.body).toMatchObject({
      error: 'Tenant token cap exceeded',
      code: 'TENANT_TOKEN_MONTHLY_CAP_EXCEEDED',
      monthlyUsedTokens: 9999,
      monthlyCapTokens: 10_000,
      retryAtUtc: '2026-06-01T00:00:00.000Z',
    });
  });

  it('returns 200 SSE stream when allowance is granted', async () => {
    mockCheckAllowance.mockResolvedValue(ALLOWANCE_ALLOWED);

    const response = await request(app)
      .post('/api/chat')
      .send({ messages: VALID_MESSAGES })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.text).toContain('event: start');
    expect(mockRecordUsage).toHaveBeenCalledOnce();
  });

  it('does not call recordUsage when cap is exceeded', async () => {
    mockCheckAllowance.mockResolvedValue(DAILY_CAP_EXCEEDED);

    await request(app).post('/api/chat').send({ messages: VALID_MESSAGES }).expect(429);

    expect(mockRecordUsage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WebSocket tests
// ---------------------------------------------------------------------------

describe('Cap enforcement — WebSocket (/ws/chat)', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    mockCheckAllowance.mockClear();
    mockRecordUsage.mockClear();
    mockChatStream.mockClear();

    server = http.createServer();
    registerChatWebSocket(server, createMockPool());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function connectAndSend(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
        headers: { Authorization: 'Bearer MOCK.validtoken' },
      });

      const cleanup = (fn: () => void) => {
        ws.close();
        fn();
      };

      ws.on('error', (err) => reject(err));

      ws.on('open', () => {
        ws.send(JSON.stringify(payload));
      });

      // Collect all messages until the socket closes or we see an error/done frame.
      const messages: Record<string, unknown>[] = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        messages.push(msg);

        if (msg.type === 'error' || msg.type === 'done') {
          cleanup(() => resolve(msg));
        }
      });

      ws.on('close', () => {
        if (messages.length > 0) {
          resolve(messages[messages.length - 1]);
        } else {
          reject(new Error('WebSocket closed without any messages'));
        }
      });

      setTimeout(() => cleanup(() => reject(new Error('WebSocket test timed out'))), 5000);
    });
  }

  it('sends error frame with TENANT_TOKEN_DAILY_CAP_EXCEEDED when daily cap is exceeded', async () => {
    mockCheckAllowance.mockResolvedValue(DAILY_CAP_EXCEEDED);

    const msg = await connectAndSend({ type: 'start', messages: VALID_MESSAGES });

    expect(msg).toMatchObject({
      type: 'error',
      code: 'TENANT_TOKEN_DAILY_CAP_EXCEEDED',
      dailyUsedTokens: 950,
      dailyCapTokens: 1000,
      retryAtUtc: '2026-05-01T00:00:00.000Z',
    });
  });

  it('sends error frame with TENANT_TOKEN_MONTHLY_CAP_EXCEEDED when monthly cap is exceeded', async () => {
    mockCheckAllowance.mockResolvedValue(MONTHLY_CAP_EXCEEDED);

    const msg = await connectAndSend({ type: 'start', messages: VALID_MESSAGES });

    expect(msg).toMatchObject({
      type: 'error',
      code: 'TENANT_TOKEN_MONTHLY_CAP_EXCEEDED',
      monthlyCapTokens: 10_000,
      retryAtUtc: '2026-06-01T00:00:00.000Z',
    });
  });

  it('does not call recordUsage when cap is exceeded over WebSocket', async () => {
    mockCheckAllowance.mockResolvedValue(DAILY_CAP_EXCEEDED);

    await connectAndSend({ type: 'start', messages: VALID_MESSAGES });

    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('streams normally when allowance is granted', async () => {
    mockCheckAllowance.mockResolvedValue(ALLOWANCE_ALLOWED);

    const msg = await connectAndSend({ type: 'start', messages: VALID_MESSAGES });

    // The final message should be 'done' (or 'start' if done never comes — but
    // the mock yields finishReason so 'done' is expected).
    expect(msg.type).toBe('done');
    expect(mockRecordUsage).toHaveBeenCalledOnce();
  });
});
