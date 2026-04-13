/**
 * Test for Redis stream store
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeStreamState,
  getStreamState,
  updateStreamState,
  deleteStreamState,
  addStreamChunk,
  markStreamFinished,
  StreamState,
} from '../stream-store.js';

// Mock the Redis client
vi.mock('../client.js', () => ({
  getRedisClient: vi.fn(() => ({
    setEx: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
  })),
}));

describe('Redis Stream Store', () => {
  const mockStreamState: StreamState = {
    id: 'test-stream-123',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    options: {
      model: 'gpt-4',
      temperature: 0.7,
      stream: true,
    },
    chunks: ['Hello', ' ', 'world'],
    finished: false,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should store stream state', async () => {
    const mockClient = {
      setEx: vi.fn().mockResolvedValue('OK'),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    await storeStreamState(mockStreamState);

    expect(getRedisClient).toHaveBeenCalled();
    expect(mockClient.setEx).toHaveBeenCalledWith(
      'chat_stream:test-stream-123',
      300, // 5 minutes TTL
      JSON.stringify(mockStreamState)
    );
  });

  it('should get stream state', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue(JSON.stringify(mockStreamState)),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    const result = await getStreamState('test-stream-123');

    expect(getRedisClient).toHaveBeenCalled();
    expect(mockClient.get).toHaveBeenCalledWith('chat_stream:test-stream-123');
    expect(result).toEqual(mockStreamState);
  });

  it('should return null for non-existent stream', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue(null),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    const result = await getStreamState('non-existent');

    expect(result).toBeNull();
  });

  it('should update stream state', async () => {
    const existingState = { ...mockStreamState };
    const updates = { finished: true, error: 'Test error' };

    const mockClient = {
      get: vi.fn().mockResolvedValue(JSON.stringify(existingState)),
      setEx: vi.fn().mockResolvedValue('OK'),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    await updateStreamState('test-stream-123', updates);

    expect(mockClient.get).toHaveBeenCalledWith('chat_stream:test-stream-123');
    expect(mockClient.setEx).toHaveBeenCalledWith(
      'chat_stream:test-stream-123',
      300,
      JSON.stringify({ ...existingState, ...updates })
    );
  });

  it('should delete stream state', async () => {
    const mockClient = {
      del: vi.fn().mockResolvedValue(1),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    await deleteStreamState('test-stream-123');

    expect(mockClient.del).toHaveBeenCalledWith('chat_stream:test-stream-123');
  });

  it('should add chunk to stream', async () => {
    const existingState = { ...mockStreamState, chunks: ['Hello'] };

    const mockClient = {
      get: vi.fn().mockResolvedValue(JSON.stringify(existingState)),
      setEx: vi.fn().mockResolvedValue('OK'),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    await addStreamChunk('test-stream-123', ' world');

    expect(mockClient.get).toHaveBeenCalledWith('chat_stream:test-stream-123');
    expect(mockClient.setEx).toHaveBeenCalledWith(
      'chat_stream:test-stream-123',
      300,
      JSON.stringify({ ...existingState, chunks: ['Hello', ' world'] })
    );
  });

  it('should mark stream as finished', async () => {
    const existingState = { ...mockStreamState, finished: false };
    const error = 'Test error';

    const mockClient = {
      get: vi.fn().mockResolvedValue(JSON.stringify(existingState)),
      setEx: vi.fn().mockResolvedValue('OK'),
    };
    const { getRedisClient } = await import('../client.js');
    (getRedisClient as any).mockResolvedValue(mockClient);

    await markStreamFinished('test-stream-123', error);

    expect(mockClient.get).toHaveBeenCalledWith('chat_stream:test-stream-123');
    expect(mockClient.setEx).toHaveBeenCalledWith(
      'chat_stream:test-stream-123',
      300,
      JSON.stringify({ ...existingState, finished: true, error })
    );
  });
});
