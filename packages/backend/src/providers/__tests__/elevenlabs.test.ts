/**
 * ElevenLabs Provider Unit Tests
 *
 * Tests: text-to-speech, voice selection, error states, retry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsProvider, ElevenLabsProviderError } from '../implementations/elevenlabs';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ElevenLabsProvider', () => {
  let provider: ElevenLabsProvider;

  beforeEach(() => {
    provider = new ElevenLabsProvider({
      apiKey: 'test-api-key',
      defaultModel: 'eleven_multilingual_v2',
      defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
      maxRetries: 3,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('speak', () => {
    it('should successfully generate speech', async () => {
      const audioData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(audioData);
            controller.close();
          },
        }),
      });

      const result = await provider.speak('Hello world');

      expect(result.audioBuffer).toBeDefined();
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('should use custom voice ID', async () => {
      const audioData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(audioData);
            controller.close();
          },
        }),
      });

      await provider.speak('Hello', { voice_id: 'custom-voice-id' });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('custom-voice-id');
    });

    it('should use custom voice settings', async () => {
      const audioData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(audioData);
            controller.close();
          },
        }),
      });

      await provider.speak('Hello', {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.5,
      });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.voice_settings.stability).toBe(0.7);
      expect(calledBody.voice_settings.similarity_boost).toBe(0.8);
      expect(calledBody.voice_settings.style).toBe(0.5);
    });

    it('should retry on rate limit error', async () => {
      const audioData = new Uint8Array([1, 2, 3, 4]);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['Retry-After', '1']]),
          json: () => Promise.resolve({ detail: { status: 'rate_limit', message: 'Rate limit' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(audioData);
              controller.close();
            },
          }),
        });

      const result = await provider.speak('Hello');
      expect(result.audioBuffer).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: { status: 'error', message: 'Server error' } }),
      });

      await expect(provider.speak('Hello')).rejects.toThrow(ElevenLabsProviderError);

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('getVoices', () => {
    it('should return list of voices', async () => {
      const mockVoices = [
        { voice_id: 'voice-1', name: 'Alice', category: 'premade' },
        { voice_id: 'voice-2', name: 'Bob', category: 'cloned' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ voices: mockVoices }),
      });

      const voices = await provider.getVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0].name).toBe('Alice');
      expect(voices[1].name).toBe('Bob');
    });
  });

  describe('unsupported operations', () => {
    it('should throw error for chat', async () => {
      await expect(provider.chat([{ role: 'user', content: 'Hello' }])).rejects.toThrow();
    });

    it('should throw error for transcribe', async () => {
      await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow();
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
