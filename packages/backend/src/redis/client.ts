import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;
let redisConnectionState: 'idle' | 'connecting' | 'ready' | 'error' | 'closed' = 'idle';
let lastRedisError: string | null = null;

/**
 * Get or create Redis client singleton
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  redisClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          console.error('Redis: Max reconnection attempts reached');
          return new Error('Max reconnection attempts reached');
        }
        return Math.min(retries * 100, 3000);
      },
      tls: redisUrl.startsWith('rediss://') ? true : undefined,
    },
  }) as RedisClientType;

  redisClient.on('error', (err: Error) => {
    redisConnectionState = 'error';
    lastRedisError = err.message;
    console.error('Redis Client Error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected');
    connectionAttempts = 0; // Reset on successful connection
    redisConnectionState = 'ready';
    lastRedisError = null;
  });

  redisClient.on('reconnecting', () => {
    redisConnectionState = 'connecting';
    console.log('🔄 Redis reconnecting...');
  });

  try {
    redisConnectionState = 'connecting';
    connectionAttempts++;
    if (connectionAttempts > MAX_CONNECTION_ATTEMPTS) {
      throw new Error(`Failed to connect to Redis after ${MAX_CONNECTION_ATTEMPTS} attempts`);
    }

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    redisConnectionState = 'error';
    lastRedisError = error instanceof Error ? error.message : 'Unknown Redis connection error';
    console.error('Failed to connect to Redis:', error);
    redisClient = null; // Reset client so next call will try again
    throw error;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisConnectionState = 'closed';
  }
}

/**
 * Runtime health snapshot for the shared Redis singleton.
 */
export function getRedisClientHealth(): {
  ready: boolean;
  state: 'idle' | 'connecting' | 'ready' | 'error' | 'closed';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
} {
  return {
    ready: Boolean(redisClient && redisClient.isReady && redisConnectionState === 'ready'),
    state: redisConnectionState,
    attempts: connectionAttempts,
    maxAttempts: MAX_CONNECTION_ATTEMPTS,
    lastError: lastRedisError,
  };
}

/**
 * Build the Redis set key used to track a user's active refresh token IDs.
 */
function getUserTokensKey(userId: string): string {
  return `user_tokens:${userId}`;
}

/**
 * Store refresh token in Redis with TTL
 */
export async function storeRefreshToken(
  userId: string,
  tokenId: string,
  ttlSeconds: number = 7 * 24 * 60 * 60 // 7 days default
): Promise<void> {
  const client = await getRedisClient();
  const refreshKey = `refresh_token:${tokenId}`;
  const userTokensKey = getUserTokensKey(userId);

  const pipeline = client.multi();
  pipeline.setEx(refreshKey, ttlSeconds, userId);
  pipeline.sAdd(userTokensKey, tokenId);
  pipeline.expire(userTokensKey, ttlSeconds);
  await pipeline.exec();
}

/**
 * Verify refresh token exists in Redis
 */
export async function verifyRefreshToken(tokenId: string): Promise<string | null> {
  const client = await getRedisClient();
  const refreshKey = `refresh_token:${tokenId}`;

  return (await client.get(refreshKey)) as string | null;
}

/**
 * Revoke a specific refresh token
 */
export async function revokeRefreshToken(tokenId: string): Promise<void> {
  const client = await getRedisClient();
  const refreshKey = `refresh_token:${tokenId}`;
  const userId = (await client.get(refreshKey)) as string | null;

  if (!userId) {
    return;
  }

  const userTokensKey = getUserTokensKey(userId);
  const pipeline = client.multi();
  pipeline.del(refreshKey);
  pipeline.sRem(userTokensKey, tokenId);
  await pipeline.exec();
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const client = await getRedisClient();
  const userTokensKey = getUserTokensKey(userId);
  const tokenIds = await client.sMembers(userTokensKey);

  if (tokenIds.length === 0) {
    await client.del(userTokensKey);
    return;
  }

  const pipeline = client.multi();
  tokenIds.forEach((tokenId) => pipeline.del(`refresh_token:${tokenId}`));
  pipeline.del(userTokensKey);
  await pipeline.exec();
}

/**
 * Get all active refresh tokens for a user
 */
export async function getUserActiveTokens(userId: string): Promise<string[]> {
  const client = await getRedisClient();
  const userTokensKey = getUserTokensKey(userId);
  const tokenIds = await client.sMembers(userTokensKey);

  if (tokenIds.length === 0) {
    return [];
  }

  const pipeline = client.multi();
  tokenIds.forEach((tokenId) => pipeline.exists(`refresh_token:${tokenId}`));
  const results = (await pipeline.exec()) as unknown as Array<number | null>;

  return tokenIds.filter((_, index) => results[index] === 1);
}
