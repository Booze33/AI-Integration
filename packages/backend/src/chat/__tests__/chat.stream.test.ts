/**
 * Chat Stream Endpoint Tests
 *
 * Focused tests for authenticated SSE chat streaming behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Pool } from 'pg';
import { createChatRoutes } from '../index';

const mockUser = {
  userId: 'user-1',
  email: 'tester@example.com',
  role: 'member',
  tenantId: 'tenant-1',
};

vi.mock('../../auth/middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockUser;
    next();
  },
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));

const streamCache = new Map<string, any>();
vi.mock('../../redis/stream-store', () => ({
  storeStreamState: vi.fn(async (state: any) => {
    streamCache.set(state.id, state);
  }),
  getStreamState: vi.fn(async (id: string) => streamCache.get(id) || null),
  deleteStreamState: vi.fn(async (id: string) => {
    streamCache.delete(id);
  }),
  addStreamChunk: vi.fn(async (id: string, chunk: string) => {
    const state = streamCache.get(id);
    if (!state) return;
    state.chunks.push(chunk);
    streamCache.set(id, state);
  }),
  markStreamFinished: vi.fn(async (id: string, error?: string) => {
    const state = streamCache.get(id);
    if (!state) return;
    state.finished = true;
    state.error = error;
    streamCache.set(id, state);
  }),
  cleanupOldStreams: vi.fn(async () => {}),
}));

const mockChatStream = vi.fn(async function* () {
  yield { id: 'test-1', delta: { content: 'Hello' }, model: 'mock-model' };
  yield { id: 'test-2', delta: { content: ' world' }, model: 'mock-model' };
  yield {
    id: 'test-3',
    delta: { content: '!' },
    model: 'mock-model',
    finishReason: 'stop',
  };
});

const mockGetProvider = vi.fn();
vi.mock('../../providers', () => ({
  getProvider: (...args: any[]) => mockGetProvider(...args),
}));

function createMockPool(): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, user_id, user_email')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
}

describe('Chat Stream Endpoint', () => {
  let app: express.Application;

  beforeEach(() => {
    streamCache.clear();
    mockChatStream.mockClear();
    mockGetProvider.mockReturnValue({
      name: 'mock-provider',
      supportedModels: ['mock-model'],
      chatStream: mockChatStream,
      createRealtimeSession: undefined,
    });

    app = express();
    app.use(express.json());
    app.use('/api', createChatRoutes(createMockPool()));
  });

  describe('POST /api/chat', () => {
    it('should reject empty messages array', async () => {
      const response = await request(app).post('/api/chat').send({ messages: [] }).expect(400);

      expect(response.body).toEqual({
        error: 'Invalid request',
        message: 'messages array is required and must not be empty',
      });
    });

    it('should reject missing messages', async () => {
      const response = await request(app).post('/api/chat').send({}).expect(400);

      expect(response.body).toEqual({
        error: 'Invalid request',
        message: 'messages array is required and must not be empty',
      });
    });

    it('should reject invalid message format', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user' }] })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid message format',
        message: 'Each message must have role and content',
      });
    });

    it('should reject invalid message role', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'invalid', content: 'Hello' }] })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid message role',
        message: 'Role must be one of: system, user, assistant, function',
      });
    });

    it('should stream SSE response with correct headers', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'Hello' }] })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache, no-transform')
        .expect('Connection', 'keep-alive');

      const rawEvents = response.text.split('\n\n');
      const parsedEvents = rawEvents
        .filter((event: string) => event.trim())
        .map((event: string) => {
          const lines = event.split('\n');
          const eventType = lines.find((l) => l.startsWith('event:'))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith('data:'));
          const data = dataLine ? JSON.parse(dataLine.slice(6)) : null;
          return { type: eventType, data };
        });

      expect(parsedEvents.some((e) => e.type === 'start')).toBe(true);
      expect(parsedEvents.some((e) => e.type === 'chunk')).toBe(true);
      expect(parsedEvents.some((e) => e.type === 'done')).toBe(true);
    });

    it('should include streamId in the start event payload', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'Hello' }] })
        .expect(200);

      const rawEvents = response.text.split('\n\n');
      const startEvent = rawEvents.find((e: string) => e.includes('event: start'));
      expect(startEvent).toBeDefined();

      const dataLine = startEvent?.split('\n').find((l) => l.startsWith('data:'));
      const data = JSON.parse(dataLine?.slice(6) || '{}');
      expect(data.id).toBeDefined();
      expect(data.streamId).toBe(data.id);
      expect(data.model).toBeDefined();
    });
  });
});

describe('Chat Stream Endpoint - Error Handling', () => {
  let app: express.Application;

  beforeEach(() => {
    streamCache.clear();
    app = express();
    app.use(express.json());
    app.use('/api', createChatRoutes(createMockPool()));
  });

  it('should handle provider errors gracefully', async () => {
    mockGetProvider.mockReturnValueOnce({
      name: 'error-provider',
      supportedModels: ['error-model'],
      chatStream: vi.fn(async function* () {
        yield {
          id: 'error-1',
          delta: { content: 'Partial' },
          model: 'error-model',
        };
        throw new Error('Provider error');
      }),
      createRealtimeSession: undefined,
    });

    const response = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Hello' }] })
      .expect(200);

    const rawEvents = response.text.split('\n\n');
    const chunkEvent = rawEvents.find((e: string) => e.includes('event: chunk'));
    const errorEvent = rawEvents.find((e: string) => e.includes('event: error'));

    expect(chunkEvent).toBeDefined();
    expect(errorEvent).toBeDefined();

    const dataLine = errorEvent?.split('\n').find((l) => l.startsWith('data:'));
    const data = JSON.parse(dataLine?.slice(6) || '{}');
    expect(data.message).toBe('Provider error');
  });
});

describe('Chat Session ID — persistent history grouping', () => {
  let pool: Pool;
  let app: express.Application;

  beforeEach(() => {
    streamCache.clear();
    mockChatStream.mockClear();
    mockGetProvider.mockReturnValue({
      name: 'mock-provider',
      supportedModels: ['mock-model'],
      chatStream: mockChatStream,
      createRealtimeSession: undefined,
    });

    pool = createMockPool();
    app = express();
    app.use(express.json());
    app.use('/api', createChatRoutes(pool));
  });

  it('uses provided valid sessionId as stream_id in history INSERT', async () => {
    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Hello' }], sessionId })
      .expect(200);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    const insertCall = queryMock.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' && (args[0] as string).includes('INSERT INTO app.chat_history')
    );
    expect(insertCall).toBeDefined();
    // The sessionId (historyStreamId) is the 4th positional param ($4)
    expect((insertCall as any[])[1][3]).toBe(sessionId);
  });

  it('falls back to generated stream_id when no sessionId is provided', async () => {
    await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Hello' }] })
      .expect(200);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    const insertCall = queryMock.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' && (args[0] as string).includes('INSERT INTO app.chat_history')
    );
    expect(insertCall).toBeDefined();
    const usedStreamId: string = (insertCall as any[])[1][3];
    // Should be a valid UUID generated by the backend, not null
    expect(usedStreamId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('ignores invalid sessionId and uses generated stream_id instead', async () => {
    await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'Hello' }],
        sessionId: 'not-a-valid-uuid',
      })
      .expect(200);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    const insertCall = queryMock.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' && (args[0] as string).includes('INSERT INTO app.chat_history')
    );
    expect(insertCall).toBeDefined();
    const usedStreamId: string = (insertCall as any[])[1][3];
    // Must not be the invalid value we sent
    expect(usedStreamId).not.toBe('not-a-valid-uuid');
    expect(usedStreamId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('second turn with same sessionId produces a row with the same stream_id', async () => {
    const sessionId = 'cafebabe-dead-beef-cafe-babe00000000';

    await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'First' }], sessionId })
      .expect(200);

    await request(app)
      .post('/api/chat')
      .send({
        messages: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Hello world!' },
          { role: 'user', content: 'Second' },
        ],
        sessionId,
      })
      .expect(200);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    const insertCalls = queryMock.mock.calls.filter(
      (args) =>
        typeof args[0] === 'string' && (args[0] as string).includes('INSERT INTO app.chat_history')
    );
    expect(insertCalls).toHaveLength(2);
    // Both inserts must use the client-provided sessionId
    expect((insertCalls[0] as any[])[1][3]).toBe(sessionId);
    expect((insertCalls[1] as any[])[1][3]).toBe(sessionId);
  });
});
