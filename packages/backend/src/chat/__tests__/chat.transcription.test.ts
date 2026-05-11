/**
 * Chat Transcription Session Tests
 *
 * Focused tests for the new transcription session lifecycle.
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
  yield {
    id: 'test-1',
    delta: { content: 'Hello' },
    model: 'mock-model',
    finishReason: 'stop',
  };
});

const mockCreateRealtimeSession = vi.fn(async (options?: any) => {
  return {
    send: (_audio: Buffer | ArrayBuffer) => {
      options?.onTranscription?.({
        transcript: 'partial transcript',
        isFinal: false,
        confidence: 0.92,
      });
    },
    close: () => {
      options?.onClose?.();
    },
    getState: () => ({ connected: true }),
  };
});

const mockGetProvider = vi.fn();
vi.mock('../../providers', () => ({
  getProvider: (...args: any[]) => mockGetProvider(...args),
}));

function createMockPool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as Pool;
}

describe('Transcription Session Lifecycle', () => {
  let app: express.Application;

  beforeEach(() => {
    streamCache.clear();
    mockCreateRealtimeSession.mockClear();
    mockGetProvider.mockReturnValue({
      name: 'mock-provider',
      supportedModels: ['mock-model'],
      chatStream: mockChatStream,
      createRealtimeSession: mockCreateRealtimeSession,
    });

    app = express();
    app.use(express.json());
    app.use('/api', createChatRoutes(createMockPool()));
  });

  it('creates a transcription session and returns a sessionId', async () => {
    const res = await request(app).post('/api/chat/transcribe/session').send({}).expect(201);
    expect(typeof res.body.sessionId).toBe('string');
    expect(res.body.sessionId.length).toBeGreaterThan(10);
  });

  it('returns 501 when realtime transcription is not supported', async () => {
    mockGetProvider.mockReturnValueOnce({
      name: 'no-realtime-provider',
      supportedModels: ['mock-model'],
      chatStream: mockChatStream,
    });

    const res = await request(app).post('/api/chat/transcribe/session').send({}).expect(501);
    expect(res.body.error).toBe('Transcription not supported');
  });

  it('accepts audio chunks for a valid active session', async () => {
    const createRes = await request(app).post('/api/chat/transcribe/session').send({}).expect(201);
    const { sessionId } = createRes.body as { sessionId: string };

    const sendRes = await request(app)
      .post(`/api/chat/transcribe/${sessionId}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio-bytes'))
      .expect(200);

    expect(sendRes.body).toEqual({ success: true });
  });

  it('returns 404 for audio chunks sent to unknown session', async () => {
    const res = await request(app)
      .post('/api/chat/transcribe/unknown-session')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio-bytes'))
      .expect(404);

    expect(res.body.error).toBe('Session not found');
  });

  it('closes an active session and then rejects more audio', async () => {
    const createRes = await request(app).post('/api/chat/transcribe/session').send({}).expect(201);
    const { sessionId } = createRes.body as { sessionId: string };

    await request(app).delete(`/api/chat/transcribe/${sessionId}`).expect(200);

    await request(app)
      .post(`/api/chat/transcribe/${sessionId}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('audio-after-close'))
      .expect(404);
  });
});
