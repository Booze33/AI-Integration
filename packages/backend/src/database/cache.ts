/**
 * Multi-Level Caching System
 *
 * - L1: In-memory LRU cache (fast, local)
 * - L2: Redis cache (distributed, durable)
 * - Automatic TTL management and cache invalidation
 */

import { RedisClientType } from 'redis';

// ============================================================================
// LRU Cache Implementation (L1)
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

/**
 * Simple LRU cache with automatic expiration
 */
export class LRUCache<T> {
  private maxSize: number;
  private cache: Map<string, CacheEntry<T>> = new Map();
  private accessOrder: string[] = [];
  private ttlMs: number;

  constructor(maxSize: number = 1000, ttlMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  set(key: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs;

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }

    // Add new entry
    this.cache.set(key, { value, expiresAt, hits: 0 });
    this.accessOrder.push(key);

    // Evict oldest if exceeds max size
    if (this.cache.size > this.maxSize) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return undefined;
    }

    // Update access order
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    // Update hits
    entry.hits++;

    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    return this.cache.delete(key);
  }

  invalidatePrefix(prefix: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
        count++;
      }
    }

    keysToDelete.forEach((key) => this.delete(key));
    return count;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  getStats() {
    const entries = Array.from(this.cache.entries());
    const totalHits = entries.reduce((sum, [_, entry]) => sum + entry.hits, 0);

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalHits,
      avgHitsPerEntry: entries.length > 0 ? totalHits / entries.length : 0,
    };
  }
}

// ============================================================================
// Multi-Level Cache Manager
// ============================================================================

export interface CacheOptions {
  ttl?: number; // TTL in seconds (default: 300)
  key: string; // Cache key
  tags?: string[]; // Tags for cache invalidation
}

export class CacheManager {
  private l1Cache: LRUCache<any>;
  private l2Client: RedisClientType | null;
  private keyTags: Map<string, Set<string>> = new Map();

  constructor(
    l2Client?: RedisClientType,
    l1MaxSize: number = 1000,
    l1TtlMs: number = 5 * 60 * 1000
  ) {
    this.l1Cache = new LRUCache(l1MaxSize, l1TtlMs);
    this.l2Client = l2Client || null;
  }

  /**
   * Set value in cache (L1 -> L2)
   */
  async set<T>(value: T, options: CacheOptions): Promise<void> {
    // L1: Always set in memory
    this.l1Cache.set(options.key, value);

    // Store tags for invalidation
    if (options.tags && options.tags.length > 0) {
      if (!this.keyTags.has(options.key)) {
        this.keyTags.set(options.key, new Set());
      }

      options.tags.forEach((tag) => {
        this.keyTags.get(options.key)?.add(tag);
      });
    }

    // L2: Set in Redis if available
    if (this.l2Client) {
      try {
        const serialized = JSON.stringify(value);
        const ttlSeconds = options.ttl || 300;
        await this.l2Client.setEx(options.key, ttlSeconds, serialized);

        // Store tags in Redis for distributed invalidation
        if (options.tags && options.tags.length > 0) {
          for (const tag of options.tags) {
            const tagKey = `cache:tag:${tag}`;
            await this.l2Client.sAdd(tagKey, options.key);
            await this.l2Client.expire(tagKey, ttlSeconds);
          }
        }
      } catch (error) {
        console.error('Failed to set cache in Redis:', error);
        // Don't throw - L1 cache is sufficient fallback
      }
    }
  }

  /**
   * Get value from cache (L1 -> L2 fallback)
   */
  async get<T>(key: string): Promise<T | undefined> {
    // L1: Check memory first
    const l1Value = this.l1Cache.get(key);
    if (l1Value !== undefined) {
      return l1Value;
    }

    // L2: Check Redis if available
    if (this.l2Client) {
      try {
        const l2Value = await this.l2Client.get(key);
        if (l2Value) {
          const parsed = JSON.parse(l2Value);
          // Populate L1 from L2
          this.l1Cache.set(key, parsed);
          return parsed;
        }
      } catch (error) {
        console.error('Failed to get cache from Redis:', error);
      }
    }

    return undefined;
  }

  /**
   * Delete specific key from both L1 and L2
   */
  async delete(key: string): Promise<void> {
    this.l1Cache.delete(key);

    if (this.l2Client) {
      try {
        await this.l2Client.del(key);

        // Remove from tag mappings
        const tags = this.keyTags.get(key);
        if (tags) {
          for (const tag of tags) {
            await this.l2Client.sRem(`cache:tag:${tag}`, key);
          }
        }
      } catch (error) {
        console.error('Failed to delete from Redis cache:', error);
      }
    }

    this.keyTags.delete(key);
  }

  /**
   * Invalidate all keys with a specific tag
   */
  async invalidateTag(tag: string): Promise<number> {
    let count = 0;

    // L1: Invalidate by tag prefix
    count += this.l1Cache.invalidatePrefix(`${tag}:`);

    // L2: Invalidate by tag in Redis
    if (this.l2Client) {
      try {
        const tagKey = `cache:tag:${tag}`;
        const keysToInvalidate = await this.l2Client.sMembers(tagKey);

        for (const key of keysToInvalidate) {
          await this.delete(key);
        }

        await this.l2Client.del(tagKey);
        count += keysToInvalidate.length;
      } catch (error) {
        console.error('Failed to invalidate tag in Redis:', error);
      }
    }

    return count;
  }

  /**
   * Invalidate by prefix (e.g., "user:123:")
   * Note: Works efficiently for L1 (in-memory) cache. L2 (Redis) uses tag-based invalidation.
   */
  async invalidatePrefix(prefix: string): Promise<number> {
    // L1: Efficient prefix-based invalidation for in-memory cache
    let count = this.l1Cache.invalidatePrefix(prefix);

    // L2: For Redis, use key patterns via direct client if available
    // Note: Redis SCAN with patterns is expensive, recommend using tags instead
    if (this.l2Client && process.env.CACHE_INVALIDATE_BY_PREFIX === 'true') {
      try {
        // Warning: This is expensive on large Redis instances
        // Prefer using tags for cache invalidation
        let cursor: any = 0;
        const pattern = `${prefix}*`;

        do {
          const result: any = await (this.l2Client as any).scan(cursor, {
            MATCH: pattern,
            COUNT: 100,
          });

          cursor = result.cursor;
          const keys: string[] = result.keys || [];

          for (const key of keys) {
            await this.delete(key);
            count++;
          }
        } while (cursor !== 0);
      } catch (error) {
        console.warn('Failed to invalidate prefix in Redis (falling back to L1 only):', error);
      }
    }

    return count;
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.l1Cache.clear();
    this.keyTags.clear();

    if (this.l2Client) {
      try {
        await this.l2Client.flushDb();
      } catch (error) {
        console.error('Failed to flush Redis cache:', error);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      l1: this.l1Cache.getStats(),
      rediConnected: !!this.l2Client,
    };
  }
}
