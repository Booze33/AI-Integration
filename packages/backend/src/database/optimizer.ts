/**
 * Query Optimizer with Auto-Caching & Metrics
 *
 * Wraps database queries with:
 * - Automatic caching (configurable by query type)
 * - Performance metrics collection
 * - Slow query detection and logging
 * - Query result validation
 */

import { QueryResult, PoolClient, QueryResultRow } from 'pg';
import { CacheManager, CacheOptions } from './cache';
import { MetricsCollector } from './metrics';

// ============================================================================
// Query Configuration Types
// ============================================================================

export interface QueryConfig {
  cacheable?: boolean; // Whether query result can be cached
  cacheTtl?: number; // Cache TTL in seconds (default: 300)
  cacheTags?: string[]; // Tags for cache invalidation
  cacheKey?: string; // Override cache key generation
  skipCache?: boolean; // Force skip cache for this query
}

export enum QueryType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  UPSERT = 'UPSERT',
}

// ============================================================================
// Query Optimizer
// ============================================================================

export class QueryOptimizer {
  private cacheManager: CacheManager;
  private metricsCollector: MetricsCollector | null;

  // Cache configuration by query type
  private cacheableQueryTypes = new Set([QueryType.SELECT]);

  constructor(cacheManager: CacheManager, metricsCollector?: MetricsCollector) {
    this.cacheManager = cacheManager;
    this.metricsCollector = metricsCollector || null;
  }

  /**
   * Execute query with automatic caching and metrics
   */
  async query<T extends QueryResultRow = any>(
    client: PoolClient,
    queryString: string,
    values?: any[],
    config: QueryConfig = {}
  ): Promise<QueryResult<T>> {
    const startTime = performance.now();
    const queryType = this.detectQueryType(queryString);
    const shouldCache = this.shouldCache(queryType, config);
    let cacheKey: string | null = null;

    // Check cache for SELECT queries
    if (shouldCache && !config.skipCache) {
      cacheKey = config.cacheKey || this.generateCacheKey(queryString, values);
      const cached = await this.cacheManager.get<QueryResult<any>>(cacheKey);

      if (cached) {
        const duration = performance.now() - startTime;
        this.metricsCollector?.recordQuery({
          query: queryString,
          duration,
          rows: cached.rows.length,
          cached: true,
        });
        this.metricsCollector?.recordCacheHit();
        return cached as QueryResult<T>;
      }

      this.metricsCollector?.recordCacheMiss();
    }

    // Execute query
    let result: QueryResult<T>;
    let error: string | undefined;

    try {
      result = await client.query<T>(queryString, values);
    } catch (err) {
      error = (err as Error).message;
      const duration = performance.now() - startTime;
      this.metricsCollector?.recordQuery({
        query: queryString,
        duration,
        rows: 0,
        cached: false,
        error,
      });
      throw err;
    }

    // Cache result if applicable
    if (shouldCache && !config.skipCache && cacheKey) {
      const cacheOptions: CacheOptions = {
        key: cacheKey,
        ttl: config.cacheTtl || 300,
        tags: config.cacheTags,
      };

      await this.cacheManager.set(result, cacheOptions);
    }

    // Record metrics
    const duration = performance.now() - startTime;
    this.metricsCollector?.recordQuery({
      query: queryString,
      duration,
      rows: result.rows.length,
      cached: false,
    });

    return result;
  }

  /**
   * Helper: Execute query with logging
   */
  async queryWithLogging<T extends QueryResultRow = any>(
    client: PoolClient,
    queryString: string,
    values?: any[],
    context?: string
  ): Promise<QueryResult<T>> {
    const startTime = performance.now();

    if (process.env.NODE_ENV === 'development') {
      console.log(`📝 Query [${context || 'db'}]:`, queryString.substring(0, 100));
    }

    const result = await this.query<T>(client, queryString, values);

    const duration = performance.now() - startTime;

    if (duration > 100) {
      console.warn(`⚠️  Slow query [${context || 'db'}] (${duration.toFixed(2)}ms):`, {
        query: queryString.substring(0, 80),
      });
    }

    return result;
  }

  /**
   * Batch query execution with metrics
   */
  async queryBatch<T extends QueryResultRow = any>(
    client: PoolClient,
    queries: Array<{
      query: string;
      values?: any[];
      config?: QueryConfig;
      label?: string;
    }>
  ): Promise<QueryResult<T>[]> {
    const startTime = performance.now();
    const results: QueryResult<T>[] = [];
    let totalRows = 0;

    for (const q of queries) {
      const result = await this.query<T>(client, q.query, q.values, q.config);
      results.push(result);
      totalRows += result.rows.length;

      if (q.label && process.env.NODE_ENV === 'development') {
        console.log(`✅ Batch query ${q.label} completed`);
      }
    }

    const duration = performance.now() - startTime;

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `📊 Batch complete: ${queries.length} queries, ${totalRows} rows, ${duration.toFixed(2)}ms`
      );
    }

    return results;
  }

  /**
   * Detect query type from SQL
   */
  private detectQueryType(query: string): QueryType {
    const trimmed = query.trim().toUpperCase();

    if (trimmed.startsWith('SELECT')) return QueryType.SELECT;
    if (trimmed.startsWith('INSERT')) return QueryType.INSERT;
    if (trimmed.startsWith('UPDATE')) return QueryType.UPDATE;
    if (trimmed.startsWith('DELETE')) return QueryType.DELETE;
    if (trimmed.includes('ON CONFLICT')) return QueryType.UPSERT;

    return QueryType.SELECT; // Default to SELECT
  }

  /**
   * Determine if query should be cached
   */
  private shouldCache(queryType: QueryType, config: QueryConfig): boolean {
    if (config.cacheable === false) return false;
    if (config.cacheable === true) return true;

    // Default: only cache SELECT queries
    return this.cacheableQueryTypes.has(queryType);
  }

  /**
   * Generate deterministic cache key from query and values
   */
  private generateCacheKey(query: string, values?: any[]): string {
    // Normalize query (remove extra whitespace)
    const normalized = query.replace(/\s+/g, ' ').trim();

    // Create base key
    let key = `query:${normalized}`;

    // Add values if present
    if (values && values.length > 0) {
      const valueStr = JSON.stringify(values);
      // Hash the values to keep key length reasonable
      const hash = this.simpleHash(valueStr);
      key += `:${hash}`;
    }

    return key;
  }

  /**
   * Simple string hash function for cache keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Invalidate cache by tag
   */
  async invalidateByTag(tag: string): Promise<number> {
    return this.cacheManager.invalidateTag(tag);
  }

  /**
   * Invalidate cache by prefix
   */
  async invalidateByPrefix(prefix: string): Promise<number> {
    return this.cacheManager.invalidatePrefix(prefix);
  }

  /**
   * Get optimizer stats
   */
  getStats() {
    return {
      cache: this.cacheManager.getStats(),
      metrics: this.metricsCollector?.getMetrics(),
    };
  }
}

// ============================================================================
// Helpers for Common Query Patterns
// ============================================================================

/**
 * Get cache configuration for entity queries
 */
export function getCacheConfigForEntity(
  entityId: string,
  entityType: string,
  ttl: number = 300
): QueryConfig {
  return {
    cacheable: true,
    cacheTtl: ttl,
    cacheKey: `entity:${entityType}:${entityId}`,
    cacheTags: [entityType, `${entityType}:${entityId}`],
  };
}

/**
 * Get cache configuration for list queries
 */
export function getCacheConfigForList(
  listType: string,
  filters?: Record<string, any>,
  ttl: number = 600
): QueryConfig {
  let cacheKey = `list:${listType}`;
  if (filters) {
    const filterStr = JSON.stringify(filters);
    cacheKey += `:${Math.abs(filterStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0)).toString(36)}`;
  }

  return {
    cacheable: true,
    cacheTtl: ttl,
    cacheKey,
    cacheTags: [listType],
  };
}

/**
 * Get skip-cache configuration (for writes)
 */
export function getSkipCacheConfig(): QueryConfig {
  return { skipCache: true, cacheable: false };
}
