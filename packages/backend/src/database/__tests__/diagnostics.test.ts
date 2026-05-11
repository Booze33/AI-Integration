import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDiagnosticsRouter } from '../diagnostics';

describe('Diagnostics Router', () => {
  it('returns 503 for /metrics/prometheus when metrics collector is unavailable', async () => {
    const app = express();
    app.use('/api/diagnostics', createDiagnosticsRouter({ pool: {} as any }));

    const res = await request(app).get('/api/diagnostics/metrics/prometheus').expect(503);

    expect(res.body).toEqual({ error: 'Metrics not available' });
  });

  it('returns Prometheus text for /metrics/prometheus when metrics collector is available', async () => {
    const app = express();

    const mockMetricsCollector = {
      getMetrics: () => ({
        totalQueries: 12,
        avgQueryTime: 8.5,
        totalErrors: 1,
      }),
      getCacheStats: () => ({
        hits: 10,
        misses: 2,
        hitRate: 0.83,
      }),
      getPoolStats: () => ({
        totalCount: 5,
        idleCount: 2,
        waitingCount: 0,
      }),
    };

    app.use(
      '/api/diagnostics',
      createDiagnosticsRouter({
        metricsCollector: mockMetricsCollector as any,
        pool: {} as any,
      })
    );

    const res = await request(app).get('/api/diagnostics/metrics/prometheus').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP database_queries_total');
    expect(res.text).toContain('database_queries_total 12');
    expect(res.text).toContain('# TYPE cache_hit_rate gauge');
  });
});
