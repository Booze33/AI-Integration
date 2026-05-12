export interface ResolvedRedisConfig {
  host: string;
  port: number;
  password?: string;
  tls?: object;
}

/**
 * Resolve Redis connection settings from env vars.
 * Supports REDIS_URL, then falls back to individual REDIS_* values.
 * Sets tls: true when the URL scheme is rediss://.
 */
export function resolveRedisConfigFromEnv(): ResolvedRedisConfig {
  if (process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      const tls = redisUrl.protocol === 'rediss:' ? {} : undefined;
      return {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379', 10),
        password: redisUrl.password || undefined,
        tls,
      };
    } catch (error) {
      console.warn('Invalid REDIS_URL, falling back to individual components');
      console.warn('Error parsing REDIS_URL:', (error as Error).message);
    }
  }

  return {
    host: process.env.REDIS_HOST || process.env.HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    password: process.env.REDIS_PASSWORD,
  };
}
