/**
 * Database Monitoring & Diagnostics Routes
 *
 * Endpoints for:
 * - Performance metrics
 * - Connection pool health
 * - Cache statistics
 * - Query performance
 * - System health checks
 */

import { Router, Request, Response } from 'express';
import { MetricsCollector } from './metrics';
import { CacheManager } from './cache';
import { QueryOptimizer } from './optimizer';
import { OptimizedConnectionPool } from './pool-optimizer';
import { Pool } from 'pg';
import packageJson from '../../package.json';

export interface DiagnosticsContext {
  metricsCollector?: MetricsCollector;
  cacheManager?: CacheManager;
  queryOptimizer?: QueryOptimizer;
  pool: OptimizedConnectionPool | Pool;
}

/**
 * Create diagnostics router
 */
export function createDiagnosticsRouter(ctx: DiagnosticsContext): Router {
  const router = Router();

  // ========================================================================
  // Health & Status Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/health
   * Overall system health status
   */
  router.get('/health', (_req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ error: 'Metrics not available' });
      return;
    }

    const health = ctx.metricsCollector.getHealthStatus();
    const poolStats = ctx.metricsCollector.getPoolStats();
    const cacheStats = ctx.metricsCollector.getCacheStats();

    res.json({
      status: health.status,
      timestamp: new Date(),
      checks: {
        pool: poolStats,
        cache: cacheStats,
        details: health.details,
      },
    });
  });

  /**
   * GET /diagnostics/ready
   * Readiness check (for Kubernetes/orchestration)
   */
  router.get('/ready', (_req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ ready: false });
      return;
    }

    const health = ctx.metricsCollector.getHealthStatus();
    const isReady = health.status !== 'unhealthy';

    res.status(isReady ? 200 : 503).json({
      ready: isReady,
      status: health.status,
    });
  });

  /**
   * GET /diagnostics/live
   * Liveness check (for Kubernetes/orchestration)
   */
  router.get('/live', (_req: Request, res: Response) => {
    res.json({ alive: true, timestamp: new Date() });
  });

  // ========================================================================
  // Metrics Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/metrics
   * Complete metrics snapshot
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ error: 'Metrics not available' });
      return;
    }

    const metrics = ctx.metricsCollector.getMetrics();
    res.json(metrics);
  });

  /**
   * GET /diagnostics/metrics/window?duration=60000
   * Metrics over time window (in milliseconds)
   */
  router.get('/metrics/window', (req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ error: 'Metrics not available' });
      return;
    }

    const duration = parseInt(req.query.duration as string) || 60000;
    const metrics = ctx.metricsCollector.getMetricsWindow(duration);

    res.json({
      window: { durationMs: duration },
      metrics,
    });
  });

  /**
   * GET /diagnostics/metrics/slow-queries?limit=10
   * List slow queries
   */
  router.get('/metrics/slow-queries', (req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ error: 'Metrics not available' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const queries = ctx.metricsCollector.getSlowQueries(limit);

    res.json({
      limit,
      count: queries.length,
      queries,
    });
  });

  // ========================================================================
  // Connection Pool Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/pool
   * Connection pool status
   */
  router.get('/pool', (_req: Request, res: Response) => {
    if (!ctx.metricsCollector) {
      res.status(503).json({ error: 'Metrics not available' });
      return;
    }

    const poolStats = ctx.metricsCollector.getPoolStats();
    const utilization = (poolStats.totalCount - poolStats.idleCount) / poolStats.totalCount;

    res.json({
      stats: poolStats,
      utilization: {
        percentage: (utilization * 100).toFixed(2),
        raw: utilization,
      },
      health: {
        status: utilization > 0.9 ? 'warning' : utilization > 0.8 ? 'caution' : 'healthy',
        recommendations:
          utilization > 0.9
            ? [
                'Increase pool size',
                'Check for long-running queries',
                'Monitor for connection leaks',
              ]
            : [],
      },
    });
  });

  // ========================================================================
  // Cache Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/cache
   * Cache statistics
   */
  router.get('/cache', (_req: Request, res: Response) => {
    if (!ctx.cacheManager) {
      res.status(503).json({ error: 'Cache not available' });
      return;
    }

    const stats = ctx.cacheManager.getStats();

    res.json({
      l1: stats.l1,
      l2Connected: stats.rediConnected,
      recommendations:
        stats.l1 && stats.l1.totalHits === 0 && stats.l1.size > 500
          ? ['Consider adjusting cache TTL', 'Monitor cache effectiveness']
          : [],
    });
  });

  /**
   * POST /diagnostics/cache/clear
   * Clear cache
   */
  router.post('/cache/clear', async (_req: Request, res: Response) => {
    if (!ctx.cacheManager) {
      res.status(503).json({ error: 'Cache not available' });
      return;
    }

    try {
      await ctx.cacheManager.clear();
      res.json({ message: 'Cache cleared' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /diagnostics/cache/invalidate-tag
   * Invalidate cache by tag
   */
  router.post('/cache/invalidate-tag', async (req: Request, res: Response) => {
    if (!ctx.cacheManager) {
      res.status(503).json({ error: 'Cache not available' });
      return;
    }

    const { tag } = req.body;

    if (!tag) {
      res.status(400).json({ error: 'Tag required' });
      return;
    }

    try {
      const count = await ctx.cacheManager.invalidateTag(tag);
      res.json({ message: `Invalidated ${count} cache entries`, count });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /diagnostics/cache/invalidate-prefix
   * Invalidate cache by prefix
   */
  router.post('/cache/invalidate-prefix', async (req: Request, res: Response) => {
    if (!ctx.cacheManager) {
      res.status(503).json({ error: 'Cache not available' });
      return;
    }

    const { prefix } = req.body;

    if (!prefix) {
      res.status(400).json({ error: 'Prefix required' });
      return;
    }

    try {
      const count = await ctx.cacheManager.invalidatePrefix(prefix);
      res.json({ message: `Invalidated ${count} cache entries`, count });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ========================================================================
  // Query Performance Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/query-stats
   * Query performance statistics
   */
  router.get('/query-stats', (_req: Request, res: Response) => {
    if (!ctx.queryOptimizer) {
      res.status(503).json({ error: 'Query optimizer not available' });
      return;
    }

    const stats = ctx.queryOptimizer.getStats();

    res.json(stats);
  });

  // ========================================================================
  // System Information Endpoints
  // ========================================================================

  /**
   * GET /diagnostics/info
   * System information
   */
  router.get('/info', (_req: Request, res: Response) => {
    res.json({
      version: packageJson.version,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
        unit: 'MB',
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        debug: process.env.DEBUG === 'true',
      },
    });
  });

  /**
   * GET /diagnostics/report
   * Comprehensive diagnostic report
   */
  router.get('/report', (_req: Request, res: Response) => {
    const report: any = {
      timestamp: new Date(),
      status: 'generating',
    };

    if (ctx.metricsCollector) {
      const health = ctx.metricsCollector.getHealthStatus();
      const metrics = ctx.metricsCollector.getMetrics();

      report.health = health;
      report.metrics = metrics;
    }

    if (ctx.cacheManager) {
      report.cache = ctx.cacheManager.getStats();
    }

    if (ctx.queryOptimizer) {
      report.queryPerformance = ctx.queryOptimizer.getStats();
    }

    res.json(report);
  });

  return router;
}

// ============================================================================
// Telemetry Export Functions (for Prometheus, DataDog, etc.)
// ============================================================================

/**
 * Export metrics in Prometheus format
 */
export function exportPrometheusMetrics(ctx: DiagnosticsContext): string {
  const metrics: string[] = [];

  if (ctx.metricsCollector) {
    const data = ctx.metricsCollector.getMetrics();
    const cache = ctx.metricsCollector.getCacheStats();
    const pool = ctx.metricsCollector.getPoolStats();

    metrics.push(`# HELP database_queries_total Total number of queries`);
    metrics.push(`# TYPE database_queries_total counter`);
    metrics.push(`database_queries_total ${data.totalQueries}`);

    metrics.push(`# HELP database_query_duration_ms Average query duration`);
    metrics.push(`# TYPE database_query_duration_ms gauge`);
    metrics.push(`database_query_duration_ms ${data.avgQueryTime.toFixed(2)}`);

    metrics.push(`# HELP database_query_errors_total Total query errors`);
    metrics.push(`# TYPE database_query_errors_total counter`);
    metrics.push(`database_query_errors_total ${data.totalErrors}`);

    metrics.push(`# HELP cache_hits_total Total cache hits`);
    metrics.push(`# TYPE cache_hits_total counter`);
    metrics.push(`cache_hits_total ${cache.hits}`);

    metrics.push(`# HELP cache_misses_total Total cache misses`);
    metrics.push(`# TYPE cache_misses_total counter`);
    metrics.push(`cache_misses_total ${cache.misses}`);

    metrics.push(`# HELP cache_hit_rate Cache hit rate`);
    metrics.push(`# TYPE cache_hit_rate gauge`);
    metrics.push(`cache_hit_rate ${cache.hitRate.toFixed(2)}`);

    metrics.push(`# HELP pool_connections_total Total pool connections`);
    metrics.push(`# TYPE pool_connections_total gauge`);
    metrics.push(`pool_connections_total ${pool.totalCount}`);

    metrics.push(`# HELP pool_connections_idle Idle pool connections`);
    metrics.push(`# TYPE pool_connections_idle gauge`);
    metrics.push(`pool_connections_idle ${pool.idleCount}`);

    metrics.push(`# HELP pool_connections_waiting Waiting clients`);
    metrics.push(`# TYPE pool_connections_waiting gauge`);
    metrics.push(`pool_connections_waiting ${pool.waitingCount}`);
  }

  return metrics.join('\n');
}
