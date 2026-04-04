/**
 * Database Performance Metrics Collector
 *
 * Tracks:
 * - Query execution times
 * - Connection pool stats
 * - Cache hit/miss rates
 * - Slow query detection
 * - Resource utilization
 */

import { Pool } from 'pg';

// ============================================================================
// Metrics Types
// ============================================================================

export interface QueryMetrics {
  query: string;
  duration: number; // milliseconds
  rows: number;
  timestamp: Date;
  cached: boolean;
  isSlow: boolean;
  error?: string;
}

export interface PoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  timestamp: Date;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number; // 0-1
  avgResponseTime: number; // ms
}

export interface DatabaseMetrics {
  queries: QueryMetrics[];
  pool: PoolMetrics;
  cache: CacheMetrics;
  slowQueryThreshold: number; // ms
  slowQueries: QueryMetrics[];
  avgQueryTime: number;
  totalQueries: number;
  totalErrors: number;
}

// ============================================================================
// Metrics Collector
// ============================================================================

export class MetricsCollector {
  private queries: QueryMetrics[] = [];
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private slowQueryThreshold: number; // milliseconds
  private maxMetricsSize: number; // Max historical metrics to keep
  private pool: Pool;

  constructor(pool: Pool, slowQueryThreshold: number = 1000, maxMetricsSize: number = 10000) {
    this.pool = pool;
    this.slowQueryThreshold = slowQueryThreshold;
    this.maxMetricsSize = maxMetricsSize;
  }

  /**
   * Record successful query execution
   */
  recordQuery(metrics: Omit<QueryMetrics, 'isSlow' | 'timestamp'>): void {
    const isSlow = metrics.duration > this.slowQueryThreshold;

    const record: QueryMetrics = {
      ...metrics,
      isSlow,
      timestamp: new Date(),
    };

    this.queries.push(record);

    // Trim old metrics if exceeds max size
    if (this.queries.length > this.maxMetricsSize) {
      this.queries = this.queries.slice(-this.maxMetricsSize);
    }

    if (isSlow) {
      console.warn(`⚠️  Slow query detected (${metrics.duration}ms):`, {
        query: metrics.query.substring(0, 100),
      });
    }
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): PoolMetrics {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      timestamp: new Date(),
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheMetrics {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? this.cacheHits / total : 0;
    const avgResponseTime = this.getAverageQueryTime();

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate,
      avgResponseTime,
    };
  }

  /**
   * Get average query execution time
   */
  private getAverageQueryTime(): number {
    if (this.queries.length === 0) return 0;
    const total = this.queries.reduce((sum, q) => sum + q.duration, 0);
    return total / this.queries.length;
  }

  /**
   * Get slow queries
   */
  getSlowQueries(limit: number = 10): QueryMetrics[] {
    return this.queries
      .filter((q) => q.isSlow)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  /**
   * Get comprehensive metrics summary
   */
  getMetrics(): DatabaseMetrics {
    const avgErrors = this.queries.filter((q) => q.error).length;

    return {
      queries: this.queries.slice(-100), // Last 100 queries
      pool: this.getPoolStats(),
      cache: this.getCacheStats(),
      slowQueryThreshold: this.slowQueryThreshold,
      slowQueries: this.getSlowQueries(10),
      avgQueryTime: this.getAverageQueryTime(),
      totalQueries: this.queries.length,
      totalErrors: avgErrors,
    };
  }

  /**
   * Get metrics over time window
   */
  getMetricsWindow(windowMs: number = 60 * 1000): Partial<DatabaseMetrics> {
    const cutoffTime = Date.now() - windowMs;
    const recentQueries = this.queries.filter((q) => q.timestamp.getTime() > cutoffTime);

    const slowQueries = recentQueries.filter((q) => q.isSlow);
    const avgDuration =
      recentQueries.length > 0
        ? recentQueries.reduce((sum, q) => sum + q.duration, 0) / recentQueries.length
        : 0;
    const errorCount = recentQueries.filter((q) => q.error).length;

    return {
      totalQueries: recentQueries.length,
      slowQueries: slowQueries,
      avgQueryTime: avgDuration,
      totalErrors: errorCount,
    };
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.queries = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify(this.getMetrics(), null, 2);
  }

  /**
   * Get health status based on metrics
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: string[];
  } {
    const details: string[] = [];
    const metrics = this.getMetricsWindow(60 * 1000); // Last minute

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check average query time
    if ((metrics.avgQueryTime || 0) > this.slowQueryThreshold * 2) {
      details.push(`🐢 High average query time: ${metrics.avgQueryTime?.toFixed(2)}ms`);
      status = 'degraded';
    }

    // Check slow query rate
    const slowQueryRate =
      metrics.totalQueries && metrics.slowQueries
        ? metrics.slowQueries.length / metrics.totalQueries
        : 0;
    if (slowQueryRate > 0.1) {
      details.push(`🐌 High slow query rate: ${(slowQueryRate * 100).toFixed(1)}%`);
      status = 'degraded';
    }

    // Check error rate
    const errorRate =
      metrics.totalQueries && metrics.totalErrors ? metrics.totalErrors / metrics.totalQueries : 0;
    if (errorRate > 0.05) {
      details.push(`❌ High error rate: ${(errorRate * 100).toFixed(1)}%`);
      status = 'unhealthy';
    }

    // Check pool saturation
    const poolStats = this.getPoolStats();
    const poolUsage = (poolStats.totalCount - poolStats.idleCount) / poolStats.totalCount;
    if (poolUsage > 0.9) {
      details.push(`📊 High pool saturation: ${(poolUsage * 100).toFixed(1)}%`);
      status = 'degraded';
    }

    // Check cache hit rate
    const cacheStats = this.getCacheStats();
    if (cacheStats.hitRate < 0.3) {
      details.push(`💾 Low cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
      status = 'degraded';
    }

    if (details.length === 0) {
      details.push('✅ All systems nominal');
    }

    return { status, details };
  }
}

/**
 * Global metrics collector instance
 */
let metricsCollector: MetricsCollector | null = null;

export function createMetricsCollector(
  pool: Pool,
  slowQueryThreshold?: number,
  maxMetricsSize?: number
): MetricsCollector {
  metricsCollector = new MetricsCollector(pool, slowQueryThreshold, maxMetricsSize);
  return metricsCollector;
}

export function getMetricsCollector(): MetricsCollector | null {
  return metricsCollector;
}
