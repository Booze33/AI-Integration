/**
 * Deepgram Provider Unit Tests
 *
 * Tests: real-time transcription, WebSocket handling, error states, retry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepgramProvider, DeepgramProviderError } from '../implementations/deepgram';

const mockFetch = vi.fn();
global.fetch = mockFetch;
const originalWebSocket = globalThis.WebSocket;

describe('DeepgramProvider', () => {
  let provider: DeepgramProvider;

  beforeEach(() => {
    provider = new DeepgramProvider({
      apiKey: 'test-api-key',
      defaultModel: 'nova-2',
      maxRetries: 3,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'WebSocket', {
      value: originalWebSocket,
      configurable: true,
      writable: true,
    });
    vi.doUnmock('ws');
    vi.restoreAllMocks();
  });

  describe('transcribe', () => {
    it('should successfully transcribe audio', async () => {
      const mockResponse = {
        metadata: {
          request_id: 'req-123',
          transaction_key: 'key',
          sha256: 'hash',
          created: '2024-01-01',
          duration: 5.0,
          channels: 1,
          models: ['nova-2'],
        },
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: 'Hello world',
                  confidence: 0.95,
                  words: [
                    { word: 'Hello', start: 0, end: 0.5, confidence: 0.96 },
                    { word: 'world', start: 0.6, end: 1.0, confidence: 0.94 },
                  ],
                  paragraphs: {
                    paragraphs: [
                      {
                        sentences: [{ text: 'Hello world', start: 0, end: 1.0 }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const audioBuffer = Buffer.from('fake audio data');
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('Hello world');
      expect(result.duration).toBe(5.0);
      expect(result.segments).toHaveLength(1);
      expect(result.segments![0].text).toBe('Hello world');
    });

    it('should retry on rate limit error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['Retry-After', '1']]),
          json: () => Promise.resolve({ err_code: 'rate_limit', err_msg: 'Rate limit exceeded' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              metadata: { request_id: 'req-456', duration: 3.0 },
              results: {
                channels: [
                  {
                    alternatives: [{ transcript: 'Success', confidence: 0.9 }],
                  },
                ],
              },
            }),
        });

      const result = await provider.transcribe(Buffer.from('audio'));
      expect(result.text).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ err_code: 'server_error', err_msg: 'Server error' }),
      });

      await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
        DeepgramProviderError
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should handle options correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            metadata: { duration: 2.0 },
            results: { channels: [{ alternatives: [{ transcript: 'Test' }] }] },
          }),
      });

      await provider.transcribe(Buffer.from('audio'), {
        model: 'nova-2',
        language: 'en',
        punctuate: true,
        smart_format: true,
        diarize: true,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('model=nova-2');
      expect(calledUrl).toContain('language=en');
      expect(calledUrl).toContain('punctuate=true');
      expect(calledUrl).toContain('smart_format=true');
      expect(calledUrl).toContain('diarize=true');
    });
  });

  describe('unsupported operations', () => {
    it('should throw error for chat', async () => {
      await expect(provider.chat([{ role: 'user', content: 'Hello' }])).rejects.toThrow();
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

  describe('createRealtimeSession', () => {
    it('should fall back to ws when global WebSocket is unavailable', async () => {
      const send = vi.fn();
      const close = vi.fn();

      class MockWebSocket {
        static OPEN = 1;
        readyState = MockWebSocket.OPEN;
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onclose: ((event: unknown) => void) | null = null;

        constructor(_url: string) {
          queueMicrotask(() => this.onopen?.());
        }

        send(data: string | Buffer | ArrayBuffer) {
          send(data);
        }

        close() {
          close();
        }
      }

      vi.doMock('ws', () => ({ WebSocket: MockWebSocket }));
      Object.defineProperty(globalThis, 'WebSocket', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const session = await provider.createRealtimeSession();
      await Promise.resolve();

      const audio = Buffer.from('audio');
      session.send(audio);
      session.close();

      expect(send).toHaveBeenCalledWith(audio);
      expect(close).toHaveBeenCalled();
    });

    it('should throw a provider error when no WebSocket implementation is available', async () => {
      vi.doMock('ws', () => {
        throw new Error('ws unavailable');
      });
      Object.defineProperty(globalThis, 'WebSocket', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      await expect(provider.createRealtimeSession()).rejects.toThrow(DeepgramProviderError);
    });
  });
});
