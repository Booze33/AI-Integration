/**
 * OpenAI Provider Unit Tests
 *
 * Tests: streaming, error states, retry logic, token limits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider, ProviderError, TokenLimitError } from '../implementations/openai';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider({
      apiKey: 'test-api-key',
      defaultModel: 'gpt-4o',
      maxRetries: 3,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('chat', () => {
    it('should successfully complete a chat request', async () => {
      const mockResponse = {
        id: 'chat-123',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        model: 'gpt-4o',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hello!' }]);

      expect(result.id).toBe('chat-123');
      expect(result.message.content).toBe('Hello!');
      expect(result.usage.totalTokens).toBe(15);
    });

    it('should throw TokenLimitError when tokens exceed limit', async () => {
      const longMessage = 'x'.repeat(500000); // ~125k tokens
      await expect(provider.chat([{ role: 'user', content: longMessage }])).rejects.toThrow(
        TokenLimitError
      );
    });

    it('should retry on rate limit error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['Retry-After', '1']]),
          json: () => Promise.resolve({ error: { message: 'Rate limit' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'chat-123',
              choices: [{ message: { content: 'Success' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
        });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);
      expect(result.message.content).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on server error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'chat-123',
              choices: [{ message: { content: 'Retry success' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
        });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);
      expect(result.message.content).toBe('Retry success');
    });

    it('should throw ProviderError after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Persistent error' } }),
      });

      await expect(provider.chat([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        ProviderError
      );

      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('chatStream', () => {
    it('should yield streaming chunks', async () => {
      const chunks = [
        'data: {"id":"stream-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"stream-1","choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"id":"stream-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[0]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[1]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[2]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[3]) })
          .mockResolvedValueOnce({ done: true }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const results = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Test' }])) {
        results.push(chunk);
      }

      expect(results).toHaveLength(2);
      expect(results[0].delta.content).toBe('Hello');
      expect(results[1].delta.content).toBe(' world');
    });

    it('should handle stream errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
      });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of provider.chatStream([{ role: 'user', content: 'Test' }])) {
          // Should not reach here
        }
      }).rejects.toThrow(ProviderError);
    });

    it('should retry stream on transient error', async () => {
      const chunks = [
        'data: {"id":"stream-1","choices":[{"delta":{"content":"Success"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[0]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[1]) })
          .mockResolvedValueOnce({ done: true }),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: { getReader: () => mockReader },
        });

      const results = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Test' }])) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].delta.content).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('transcribe', () => {
    it('should transcribe audio', async () => {
      const mockResponse = {
        text: 'Hello world',
        language: 'en',
        duration: 2.5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const audioBuffer = Buffer.from('fake audio data');
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('Hello world');
      expect(result.language).toBe('en');
    });
  });

  describe('speak', () => {
    it('should generate speech audio', async () => {
      const audioData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioData.buffer),
      });

      const result = await provider.speak('Hello');

      expect(result.audioBuffer).toBeDefined();
      expect(result.contentType).toBe('audio/mpeg');
    });
  });

  describe('embed', () => {
    it('should create embeddings', async () => {
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.embed('Hello');

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.model).toBe('text-embedding-3-small');
    });
  });

  describe('embedBatch', () => {
    it('should create batch embeddings', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.embedBatch(['Hello', 'World']);

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toEqual([0.1, 0.2]);
    });
  });

  describe('healthCheck', () => {
    it('should return true when healthy', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });
});
