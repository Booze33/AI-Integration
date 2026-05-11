/**
 * Database Module - Optimized with Caching & Metrics
 *
 * Complete database solution with:
 * - Multi-level caching (L1: LRU, L2: Redis)
 * - Performance metrics collection
 * - Connection pool optimization
 * - Query optimization & batch processing
 * - Health monitoring & diagnostics
 */

export {
  // Connection Pool
  OptimizedConnectionPool,
  QueuedConnectionPool,
  createPoolStatsMiddleware,
  type OptimizedPoolConfig,
  type QueuedConnectionOptions,
} from './pool-optimizer';

export {
  // Caching
  LRUCache,
  CacheManager,
  type CacheOptions,
} from './cache';

export {
  // Metrics
  MetricsCollector,
  createMetricsCollector,
  getMetricsCollector,
  type QueryMetrics,
  type PoolMetrics,
  type CacheMetrics,
  type DatabaseMetrics,
} from './metrics';

export {
  // Query Optimization
  QueryOptimizer,
  QueryType,
  getCacheConfigForEntity,
  getCacheConfigForList,
  getSkipCacheConfig,
  type QueryConfig,
} from './optimizer';

export {
  // Diagnostics & Monitoring
  createDiagnosticsRouter,
  exportPrometheusMetrics,
  type DiagnosticsContext,
} from './diagnostics';

export {
  // Original Database Client (still available)
  DatabaseClient,
  createPoolConfig,
  type DatabasePoolConfig,
  type Tenant,
  type User,
  type Project,
  type Task,
  type TenantMember,
  type Comment,
  type Tag,
  type ActivityLogEntry,
  type CreateTenantInput,
  type CreateUserInput,
  type UpdateUserInput,
  type CreateProjectInput,
  type UpdateProjectInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type CreateCommentInput,
  type UpdateCommentInput,
  type CreateTagInput,
  type TaskFilter,
  type PaginationOptions,
  type SortOptions,
} from './client';

// ============================================================================
// Single Import for Complete Setup
// ============================================================================

import { createPoolConfig, DatabaseClient } from './client';
import { OptimizedConnectionPool } from './pool-optimizer';
import { MetricsCollector, createMetricsCollector } from './metrics';
import { CacheManager } from './cache';
import { QueryOptimizer } from './optimizer';
import { getRedisClient } from '../redis/client';

export interface DatabaseSetupOptions {
  connectionString?: string;
  enableMetrics?: boolean;
  enableCache?: boolean;
  metricsThreshold?: number; // slow query threshold in ms
  cacheL1MaxSize?: number;
  cacheL1TtlMs?: number;
}

/**
 * Complete database setup with all optimizations
 */
export async function setupOptimizedDatabase(options: DatabaseSetupOptions = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    enableMetrics = true,
    enableCache = true,
    metricsThreshold = 1000,
    cacheL1MaxSize = 1000,
    cacheL1TtlMs = 5 * 60 * 1000,
  } = options;

  // Create optimized pool
  const poolConfig = createPoolConfig({ connectionString });
  const pool = new OptimizedConnectionPool(poolConfig);

  // Create metrics collector
  let metricsCollector: MetricsCollector | null = null;
  if (enableMetrics) {
    metricsCollector = createMetricsCollector(pool.getPool(), metricsThreshold, 10000);
  }

  // Create cache manager
  let cacheManager: CacheManager | null = null;
  if (enableCache) {
    const redisClient = await getRedisClient().catch(() => null);
    cacheManager = new CacheManager(redisClient || undefined, cacheL1MaxSize, cacheL1TtlMs);
  }

  // Create query optimizer
  const queryOptimizer = cacheManager
    ? new QueryOptimizer(cacheManager, metricsCollector || undefined)
    : null;

  // Create database client
  const dbClient = new DatabaseClient(pool.getPool());

  return {
    pool,
    client: dbClient,
    metrics: metricsCollector,
    cache: cacheManager,
    optimizer: queryOptimizer,
  };
}
