/**
 * Redis-based Stream Store for chat streaming sessions
 *
 * In production, this replaces the in-memory Map with Redis for:
 * - Multi-instance support
 * - Session persistence across restarts
 * - Automatic TTL-based cleanup
 */

import { getRedisClient } from './client';
import { ChatMessage, ChatOptions } from '../providers';

export interface StreamState {
  id: string;
  messages: ChatMessage[];
  options?: ChatOptions;
  chunks: string[];
  finished: boolean;
  error?: string;
  createdAt: number;
}

const STREAM_TTL_SECONDS = 5 * 60; // 5 minutes TTL for stream data
const STREAM_KEY_PREFIX = 'chat_stream:';

/**
 * Get Redis key for a stream
 */
function getStreamKey(streamId: string): string {
  return `${STREAM_KEY_PREFIX}${streamId}`;
}

/**
 * Store stream state in Redis
 */
export async function storeStreamState(streamState: StreamState): Promise<void> {
  const client = await getRedisClient();
  const key = getStreamKey(streamState.id);

  await client.setEx(key, STREAM_TTL_SECONDS, JSON.stringify(streamState));
}

/**
 * Get stream state from Redis
 */
export async function getStreamState(streamId: string): Promise<StreamState | null> {
  const client = await getRedisClient();
  const key = getStreamKey(streamId);
  const data = await client.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as StreamState;
  } catch (error) {
    console.error('Failed to parse stream state from Redis:', error);
    return null;
  }
}

/**
 * Update stream state in Redis (extends TTL)
 */
export async function updateStreamState(
  streamId: string,
  updates: Partial<StreamState>
): Promise<void> {
  const existing = await getStreamState(streamId);
  if (!existing) {
    return;
  }

  const updatedState = { ...existing, ...updates };
  await storeStreamState(updatedState);
}

/**
 * Delete stream state from Redis
 */
export async function deleteStreamState(streamId: string): Promise<void> {
  const client = await getRedisClient();
  const key = getStreamKey(streamId);
  await client.del(key);
}

/**
 * Add a chunk to stream state
 */
export async function addStreamChunk(streamId: string, chunk: string): Promise<void> {
  const existing = await getStreamState(streamId);
  if (!existing) {
    return;
  }

  existing.chunks.push(chunk);
  await storeStreamState(existing);
}

/**
 * Mark stream as finished
 */
export async function markStreamFinished(streamId: string, error?: string): Promise<void> {
  await updateStreamState(streamId, {
    finished: true,
    error,
    // Keep the stream for a shorter time when finished
  });
}

/**
 * Cleanup old streams (optional - Redis TTL handles this automatically)
 */
export async function cleanupOldStreams(): Promise<void> {
  // Redis TTL automatically removes expired streams
  // This function is kept for compatibility with the interval-based cleanup
  console.log('Redis TTL automatically handles stream cleanup');
}

/**
 * Get all active stream IDs (for monitoring/debugging)
 */
export async function getAllActiveStreamIds(): Promise<string[]> {
  const client = await getRedisClient();
  const keys = await client.keys(`${STREAM_KEY_PREFIX}*`);

  return keys.map((key) => key.replace(STREAM_KEY_PREFIX, ''));
}

/**
 * Check if a stream exists
 */
export async function streamExists(streamId: string): Promise<boolean> {
  const client = await getRedisClient();
  const key = getStreamKey(streamId);
  const exists = await client.exists(key);
  return exists === 1;
}

/**
 * Get stream TTL (time remaining in seconds)
 */
export async function getStreamTTL(streamId: string): Promise<number> {
  const client = await getRedisClient();
  const key = getStreamKey(streamId);
  return await client.ttl(key);
}
