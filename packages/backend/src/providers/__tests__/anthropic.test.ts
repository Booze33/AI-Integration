/**
 * Anthropic Provider Unit Tests
 *
 * Tests: streaming, error states, retry logic, content blocks, stop reasons
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider, AnthropicProviderError } from '../implementations/anthropic';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({
      apiKey: 'test-api-key',
      defaultModel: 'claude-3-5-sonnet-20241022',
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
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hello!' }]);
      expect(result.id).toBe('msg-123');
      expect(result.message.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
    });

    it('should handle multiple content blocks', async () => {
      const mockResponse = {
        id: 'msg-456',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1 ' },
          { type: 'text', text: 'Part 2' },
        ],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);
      expect(result.message.content).toBe('Part 1 Part 2');
    });

    it('should map stop_reason correctly', async () => {
      const testCases = [
        { stop_reason: 'end_turn', expected: 'stop' },
        { stop_reason: 'max_tokens', expected: 'length' },
        { stop_reason: 'stop_sequence', expected: 'stop' },
      ];

      for (const { stop_reason, expected } of testCases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-test',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Test' }],
              model: 'claude-3-5-sonnet-20241022',
              stop_reason,
              usage: { input_tokens: 5, output_tokens: 3 },
            }),
        });

        const result = await provider.chat([{ role: 'user', content: 'Test' }]);
        expect(result.finishReason).toBe(expected);
      }
    });

    it('should handle system messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'msg-sys',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Understood' }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 15, output_tokens: 3 },
          }),
      });

      await provider.chat([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ]);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.system).toBe('You are helpful');
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
              id: 'msg-retry',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Success' }],
              model: 'claude-3-5-sonnet-20241022',
              stop_reason: 'end_turn',
              usage: { input_tokens: 5, output_tokens: 3 },
            }),
        });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);
      expect(result.message.content).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Server error' } }),
      });

      await expect(provider.chat([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        AnthropicProviderError
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('unsupported operations', () => {
    it('should throw error for transcribe', async () => {
      await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow();
    });

    it('should throw error for speak', async () => {
      await expect(provider.speak('Hello')).rejects.toThrow();
    });

    it('should throw error for embed', async () => {
      await expect(provider.embed('Hello')).rejects.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('should return true when healthy', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });
});
