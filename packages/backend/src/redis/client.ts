import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

/**
 * Get or create Redis client singleton
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://:redis@localhost:6379';

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
    },
  });

  redisClient.on('error', (err: Error) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected');
  });

  redisClient.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...');
  });

  await redisClient.connect();
  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
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
  const key = `refresh_token:${tokenId}`;

  await client.setEx(key, ttlSeconds, userId);
}

/**
 * Verify refresh token exists in Redis
 */
export async function verifyRefreshToken(tokenId: string): Promise<string | null> {
  const client = await getRedisClient();
  const key = `refresh_token:${tokenId}`;

  return await client.get(key);
}

/**
 * Revoke a specific refresh token
 */
export async function revokeRefreshToken(tokenId: string): Promise<void> {
  const client = await getRedisClient();
  const key = `refresh_token:${tokenId}`;

  await client.del(key);
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const client = await getRedisClient();
  const pattern = 'refresh_token:*';

  const keys = await client.keys(pattern);

  for (const key of keys) {
    const storedUserId = await client.get(key);
    if (storedUserId === userId) {
      await client.del(key);
    }
  }
}

/**
 * Get all active refresh tokens for a user
 */
export async function getUserActiveTokens(userId: string): Promise<string[]> {
  const client = await getRedisClient();
  const pattern = 'refresh_token:*';

  const keys = await client.keys(pattern);
  const userTokens: string[] = [];

  for (const key of keys) {
    const storedUserId = await client.get(key);
    if (storedUserId === userId) {
      // Extract tokenId from key
      const tokenId = key.replace('refresh_token:', '');
      userTokens.push(tokenId);
    }
  }

  return userTokens;
}
