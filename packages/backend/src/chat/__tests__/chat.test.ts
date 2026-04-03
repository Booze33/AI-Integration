/**
 * Chat Endpoint Tests
 *
 * Tests for the streaming chat endpoint with SSE support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { chatRoutes } from '../index';

// Mock the provider
const mockChatStream = vi.fn(async function* () {
  yield {
    id: 'test-1',
    delta: { content: 'Hello' },
    model: 'mock-model',
  };
  yield {
    id: 'test-2',
    delta: { content: ' world' },
    model: 'mock-model',
  };
  yield {
    id: 'test-3',
    delta: { content: '!' },
    model: 'mock-model',
    finishReason: 'stop',
  };
});

vi.mock('../../providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'mock-provider',
    supportedModels: ['mock-model'],
    chatStream: mockChatStream,
  })),
}));

describe('Chat Endpoint', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', chatRoutes);
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
        .send({
          messages: [{ role: 'user' }], // missing content
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid message format',
        message: 'Each message must have role and content',
      });
    });

    it('should reject invalid message role', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          messages: [{ role: 'invalid', content: 'Hello' }],
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid message role',
        message: 'Role must be one of: system, user, assistant, function',
      });
    });

    it('should stream SSE response with correct headers', async () => {
      // Reset mock before test
      mockChatStream.mockClear();

      const response = await request(app)
        .post('/api/chat')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache, no-transform')
        .expect('Connection', 'keep-alive');

      // Parse SSE events - split by double newlines
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

      // Should have start, chunk, and done events
      expect(parsedEvents.some((e) => e.type === 'start')).toBe(true);
      expect(parsedEvents.some((e) => e.type === 'chunk')).toBe(true);
      expect(parsedEvents.some((e) => e.type === 'done')).toBe(true);
    });

    it('should include stream ID in response', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(200);

      // Check that start event has an ID
      const rawEvents = response.text.split('\n\n');
      const startEvent = rawEvents.find((e: string) => e.includes('event: start'));
      expect(startEvent).toBeDefined();

      // Parse the start event
      const dataLine = startEvent?.split('\n').find((l) => l.startsWith('data:'));
      expect(dataLine).toBeDefined();
      const data = JSON.parse(dataLine?.slice(6) || '{}');
      expect(data.id).toBeDefined();
      expect(data.model).toBeDefined();
    });
  });

  describe('GET /api/chat/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/chat/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        service: 'chat',
        activeStreams: expect.any(Number),
        timestamp: expect.any(String),
      });
    });
  });
});

describe('Chat Endpoint - Error Handling', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', chatRoutes);
  });

  it('should handle provider errors gracefully', async () => {
    // Mock provider to throw error after yielding
    const { getProvider } = await import('../../providers');
    vi.mocked(getProvider).mockReturnValueOnce({
      name: 'error-provider',
      supportedModels: ['error-model'],
      chatStream: vi.fn(async function* () {
        // Yield one chunk then throw error
        yield {
          id: 'error-1',
          delta: { content: 'Partial' },
          model: 'error-model',
        };
        throw new Error('Provider error');
      }),
    } as unknown as ReturnType<typeof getProvider>);

    const response = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'Hello' }],
      })
      .expect(200);

    // Should receive chunk and error events
    const rawEvents = response.text.split('\n\n');
    const chunkEvent = rawEvents.find((e: string) => e.includes('event: chunk'));
    const errorEvent = rawEvents.find((e: string) => e.includes('event: error'));

    expect(chunkEvent).toBeDefined();
    expect(errorEvent).toBeDefined();

    const dataLine = errorEvent?.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const data = JSON.parse(dataLine?.slice(6) || '{}');
    expect(data.message).toBe('Provider error');
  });
});
