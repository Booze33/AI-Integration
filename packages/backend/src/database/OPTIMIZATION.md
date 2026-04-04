# Database Optimization Guide

## Overview

The database module provides comprehensive optimization features for high-performance, multi-tenant SaaS applications:

- **Multi-Level Caching**: L1 (in-memory LRU) + L2 (Redis)
- **Connection Pool Optimization**: Dynamic sizing, health checks, queue management
- **Performance Metrics**: Query tracking, slow query detection, health monitoring
- **Query Optimization**: Auto-caching, batching, result validation
- **Diagnostics API**: Real-time monitoring & health checks

## Quick Start

### Basic Setup

```typescript
import { setupOptimizedDatabase } from '@/database';

// Initialize with all optimizations
const { pool, client, metrics, cache, optimizer } = await setupOptimizedDatabase({
  enableMetrics: true,
  enableCache: true,
  metricsThreshold: 1000, // slow query threshold (ms)
});

// Use database client as normal
const tenant = await client.tenants.getById('tenant-123');
```

### Integration in Express App

```typescript
import { createDiagnosticsRouter } from '@/database';
import { createPoolStatsMiddleware } from '@/database';

const app = express();

// Add pool monitoring middleware
app.use(createPoolStatsMiddleware(pool));

// Add diagnostics endpoints
app.use(
  '/api/diagnostics',
  createDiagnosticsRouter({
    metricsCollector: metrics,
    cacheManager: cache,
    queryOptimizer: optimizer,
    pool,
  })
);

// Endpoints available:
// GET  /api/diagnostics/health
// GET  /api/diagnostics/metrics
// GET  /api/diagnostics/pool
// GET  /api/diagnostics/cache
// POST /api/diagnostics/cache/clear
// GET  /api/diagnostics/slow-queries
```

## Features

### 1. Multi-Level Caching

#### L1 Cache (In-Memory LRU)

```typescript
import { LRUCache } from '@/database';

const cache = new LRUCache<User>(
  1000, // max size
  5 * 60 * 1000 // TTL in ms
);

cache.set('user:123', userData);
const cached = cache.get('user:123');
cache.invalidatePrefix('user:'); // Clear all user entries
```

#### L2 Cache (Redis)

```typescript
import { CacheManager } from '@/database';
import { getRedisClient } from '@/redis/client';

const redisClient = await getRedisClient();
const manager = new CacheManager(redisClient);

// Set with TTL and tags
await manager.set(userData, {
  key: 'user:123',
  ttl: 300, // seconds
  tags: ['user', 'user:123'],
});

// Get (falls back from L1 to L2)
const data = await manager.get('user:123');

// Invalidate by tag (clears both L1 and L2)
await manager.invalidateTag('user');

// Invalidate by prefix
await manager.invalidatePrefix('user:');
```

#### Built-in Cache Helpers

```typescript
import { getCacheConfigForEntity, getCacheConfigForList, getSkipCacheConfig } from '@/database';

// For entity queries
const config = getCacheConfigForEntity('user-123', 'users');
// Generates: { cacheKey: 'entity:users:user-123', cacheTags: ['users', 'users:user-123'] }

// For list queries
const listConfig = getCacheConfigForList('all-users', { status: 'active' });

// For writes (skip cache)
const writeConfig = getSkipCacheConfig();
```

### 2. Connection Pool Optimization

#### Configuration

```typescript
import { OptimizedConnectionPool } from '@/database';

const pool = new OptimizedConnectionPool({
  connectionString: process.env.DATABASE_URL,
  min: 2, // Minimum connections
  max: 10, // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statementTimeout: 30000,

  // Health checks
  healthCheckInterval: 30000, // 0 to disable
  healthCheckTimeout: 5000,

  // Advanced
  maxWaitingClients: 100,
});

// Get connection
const client = await pool.getConnection();

// Check pool stats
const stats = pool.getPoolStats();
// { totalCount: 10, idleCount: 7, waitingCount: 0, utilization: 0.3 }

// Get health report
const health = await pool.getHealthReport();
```

#### Recommended Pool Sizes

```
Small:      min=2,   max=10
Medium:     min=5,   max=20
Large:      min=10,  max=50
Enterprise: min=20,  max=100 (or use PgBouncer)

Formula: max_connections = (num_workers * pool_max) + 20
```

#### High-Concurrency Queue

```typescript
import { QueuedConnectionPool } from '@/database';

const queuedPool = new QueuedConnectionPool(config);

// High-priority request
const client = await queuedPool.getConnection({
  timeout: 30000,
  priority: 10, // Higher = more urgent
});

// Check queue status
const stats = queuedPool.getStats();
// { totalConnections, idleConnections, waitingRequests, utilization }
```

### 3. Performance Metrics

#### Query Metrics

```typescript
import { MetricsCollector } from '@/database';

const metrics = new MetricsCollector(
  pool.getPool(),
  1000, // slow query threshold (ms)
  10000 // max metrics to keep
);

// Record query (typically done automatically by optimizer)
metrics.recordQuery({
  query: 'SELECT * FROM users WHERE id = $1',
  duration: 45,
  rows: 1,
  cached: false,
});

// Record cache operations
metrics.recordCacheHit();
metrics.recordCacheMiss();

// Get metrics
const report = metrics.getMetrics();
// {
//   queries: [...],
//   pool: { totalCount, idleCount, waitingCount, timestamp },
//   cache: { hits, misses, hitRate, avgResponseTime },
//   slowQueries: [...],
//   avgQueryTime: 120,
//   totalQueries: 5432,
//   totalErrors: 12
// }

// Get slow queries
const slowQueries = metrics.getSlowQueries(10);

// Get metrics over time window (last 60 seconds)
const recentMetrics = metrics.getMetricsWindow(60 * 1000);

// Get health status
const health = metrics.getHealthStatus();
// {
//   status: 'healthy' | 'degraded' | 'unhealthy',
//   details: ['✅ All systems nominal']
// }
```

### 4. Query Optimization

#### Automatic Caching

```typescript
import { QueryOptimizer } from '@/database';

const optimizer = new QueryOptimizer(cacheManager, metrics);

// Execute query with automatic caching
const result = await optimizer.query(client, 'SELECT * FROM users WHERE id = $1', ['user-123'], {
  cacheable: true,
  cacheTtl: 300,
  cacheTags: ['users'],
});
// ✅ First call: query database, cache result
// ✅ Second call: return from cache

// Force skip cache
const freshResult = await optimizer.query(
  client,
  'SELECT * FROM users WHERE id = $1',
  ['user-123'],
  { skipCache: true }
);
```

#### Batch Queries

```typescript
// Execute multiple queries efficiently
const results = await optimizer.queryBatch(client, [
  {
    query: 'SELECT * FROM users WHERE id = $1',
    values: ['user-1'],
    config: { cacheable: true },
    label: 'fetch-user',
  },
  {
    query: 'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1',
    values: ['user-1'],
    config: { cacheable: true },
    label: 'count-sessions',
  },
]);
```

#### Query with Logging

```typescript
const result = await optimizer.queryWithLogging(
  client,
  'SELECT * FROM users WHERE id = $1',
  ['user-123'],
  'get-user'
);
// [dev] 📝 Query [get-user]: SELECT * FROM users WHERE id = $1
// [dev] ✅ Batch query get-user completed
```

#### Cache Invalidation

```typescript
// Invalidate by tag
const cleared = await optimizer.invalidateByTag('users');

// Invalidate by prefix
const cleared = await optimizer.invalidateByPrefix('user:');
```

### 5. Diagnostics & Monitoring

#### Health Endpoints

```bash
# Overall health status
GET /api/diagnostics/health
# {
#   "status": "healthy",
#   "timestamp": "2024-04-04T10:30:00Z",
#   "checks": { pool: {...}, cache: {...}, details: [...] }
# }

# Readiness check (for Kubernetes)
GET /api/diagnostics/ready
# { "ready": true, "status": "healthy" }

# Liveness check (for Kubernetes)
GET /api/diagnostics/live
# { "alive": true, "timestamp": "..." }
```

#### Metrics Endpoints

```bash
# Complete metrics snapshot
GET /api/diagnostics/metrics

# Metrics over time window
GET /api/diagnostics/metrics/window?duration=60000

# Slow queries (top 10)
GET /api/diagnostics/metrics/slow-queries?limit=10

# Query performance stats
GET /api/diagnostics/query-stats

# Connection pool status
GET /api/diagnostics/pool
# {
#   "stats": { totalCount, idleCount, waitingCount },
#   "utilization": { percentage, raw },
#   "health": { status, recommendations }
# }

# Cache statistics
GET /api/diagnostics/cache
# { l1: {...}, l2Connected: true, recommendations: [] }
```

#### Cache Management

```bash
# Clear all caches
POST /api/diagnostics/cache/clear

# Invalidate by tag
POST /api/diagnostics/cache/invalidate-tag
# { "tag": "users" }

# Invalidate by prefix
POST /api/diagnostics/cache/invalidate-prefix
# { "prefix": "user:" }
```

#### System Information

```bash
# System info and uptime
GET /api/diagnostics/info
# { version, nodeVersion, uptime, memory, environment }

# Comprehensive diagnostic report
GET /api/diagnostics/report
# { health, metrics, cache, queryPerformance }
```

#### Prometheus Metrics

```typescript
import { exportPrometheusMetrics } from '@/database';

app.get('/metrics', (_req, res) => {
  const prometheus = exportPrometheusMetrics({
    metricsCollector: metrics,
    cacheManager: cache,
    queryOptimizer: optimizer,
    pool,
  });
  res.type('text/plain').send(prometheus);
});
```

Available metrics:

- `database_queries_total`
- `database_query_duration_ms`
- `database_query_errors_total`
- `cache_hits_total`
- `cache_misses_total`
- `cache_hit_rate`
- `pool_connections_total`
- `pool_connections_idle`
- `pool_connections_waiting`

## Performance Tips

### 1. Cache Strategy

```typescript
// ✅ DO: Cache read-heavy queries
const user = await optimizer.query(client, 'SELECT * FROM users WHERE id = $1', [userId], {
  cacheable: true,
  cacheTtl: 600,
  cacheTags: ['users', `user:${userId}`],
});

// ❌ DON'T: Cache real-time or user-specific queries
const recentLogs = await optimizer.query(
  client,
  'SELECT * FROM logs ORDER BY created_at DESC LIMIT 100',
  [],
  { skipCache: true } // Always fresh
);
```

### 2. Tag Strategy

```typescript
// Tag by entity type (for bulk invalidation)
cacheTags: ['users']; // Invalidate all user caches

// Tag by entity ID (for specific invalidation)
cacheTags: ['users', `user:${userId}`];

// Tag by relationship (for cascade invalidation)
cacheTags: ['projects', `project:${projectId}`, 'users'];
```

### 3. Pool Configuration

```typescript
// Adjust pool size based on concurrency:
// - Concurrent Users = Expected simultaneous DB users
// - Pool Max = Concurrent Users + Buffer (usually +20%)

// Check pool utilization regularly
const stats = pool.getPoolStats();
if (stats.utilization > 0.8) {
  // Alert: Consider increasing pool size
}
```

### 4. Query Optimization

```typescript
// ✅ DO: Use indexed columns
await optimizer.query(client, 'SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [
  userId,
  tenantId,
]);

// ✅ DO: Use EXPLAIN ANALYZE
const plan = await client.query('EXPLAIN ANALYZE SELECT * FROM users WHERE tenant_id = $1', [
  tenantId,
]);

// ❌ DON'T: Select all columns
await optimizer.query(
  client,
  'SELECT * FROM users' // ❌ Never do this
);

// ✅ DO: Select needed columns
await optimizer.query(
  client,
  'SELECT id, email, first_name, last_name FROM users WHERE tenant_id = $1',
  [tenantId]
);
```

## Troubleshooting

### High Connection Pool Wait Times

```typescript
const health = await pool.getHealthReport();
// If waitingCount > 0:
// 1. Increase pool max size
// 2. Check for slow/blocked queries (see slow queries endpoint)
// 3. Check for connection leaks (ensure all connections are released)
```

### Low Cache Hit Rate

```typescript
const cache = metrics.getCacheStats();
console.log(`Hit rate: ${(cache.hitRate * 100).toFixed(1)}%`);
// If < 30%:
// 1. Review cache key generation strategy
// 2. Increase L1 cache size
// 3. Review cache TTL (may be too short)
// 4. Consider caching additional queries
```

### Slow Queries

```typescript
const slow = metrics.getSlowQueries(5);
// Review slow queries and:
// 1. Add missing database indexes
// 2. Optimize query logic
// 3. Consider denormalization for read-heavy patterns
```

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost/dbname
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_CONNECTION_TIMEOUT=5000
DB_STATEMENT_TIMEOUT=30000
DB_SSL=false

# Cache
REDIS_URL=redis://:password@localhost:6379

# Monitoring
SLOW_QUERY_THRESHOLD_MS=1000
```

## Best Practices

1. **Always invalidate cache after writes**

   ```typescript
   await cache.invalidateByTag('users');
   ```

2. **Monitor pool utilization regularly**

   ```typescript
   const report = await pool.getHealthReport();
   ```

3. **Use appropriate TTL values**
   - Fast-changing data: 60-300s
   - Stable data: 600-3600s

4. **Tag strategy matters**
   - Tag by type for bulk invalidation
   - Tag by ID for specific invalidation

5. **Profile before optimizing**
   - Use metrics to identify bottlenecks
   - Don't cache prematurely

## License

Proprietary - AI Integration
