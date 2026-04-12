import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { Pool } from 'pg';
import { setupOptimizedDatabase } from './database';
import { createDiagnosticsRouter } from './database/diagnostics';
import { runMigrations } from './database/migrate';
import { authRoutes, setAuthPool } from './auth';
import { createChatRoutes } from './chat';
import { pipelineRoutes } from './pipeline';
import { webhookRoutes } from './webhook';
import { tenantConfigRoutes, setTenantConfigPool } from './providers/routes';
import { createDashboardRoutes } from './dashboard/routes';
import { createRateLimiter } from './rate-limit';
import { requestLogger } from './logger';
import { notFoundHandler, errorHandler } from './errors';
import { closeRedisClient } from './redis/client';
import {
  validateEnv,
  printEnvConfig,
  getClientInfo,
  AuditService,
  createAuditService,
} from './audit';

// ---------------------------------------------------------------------------
// Validate environment variables on startup
// ---------------------------------------------------------------------------
const env = validateEnv();
printEnvConfig();

const app = express();
let sharedPool: Pool | null = null;
let auditService: AuditService | null = null;
let auditCleanupInterval: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// CORS — before everything else
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: env.CORS_CREDENTIALS,
  })
);

// ---------------------------------------------------------------------------
// Request logger — FIRST middleware, assigns correlation ID to every request
// ---------------------------------------------------------------------------
app.use(
  requestLogger({
    skip: (req) => req.path === '/health' || req.path === '/favicon.ico',
  })
);

// ---------------------------------------------------------------------------
// Audit middleware — attach audit service and client info
// ---------------------------------------------------------------------------
app.use((req, _res, next) => {
  if (auditService) {
    (req as any).auditService = auditService;
    (req as any).clientInfo = getClientInfo(req);
  }
  next();
});

// ---------------------------------------------------------------------------
// Health routes — BEFORE rate limiting and auth, no pool needed for /health
// ---------------------------------------------------------------------------
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.get('/health/db', async (_, res) => {
  if (!sharedPool) {
    res.status(503).json({ status: 'error', message: 'Database not initialised yet' });
    return;
  }
  const startTime = Date.now();
  try {
    const client = await sharedPool.connect();
    try {
      const result = await client.query('SELECT NOW() as time, current_database() as database');
      res.json({
        status: 'ok',
        database: {
          connected: true,
          name: result.rows[0].database,
          latency: `${Date.now() - startTime}ms`,
          timestamp: result.rows[0].time,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: {
        connected: false,
        latency: `${Date.now() - startTime}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

app.get('/health/detailed', async (_, res) => {
  if (!sharedPool) {
    res.status(503).json({ status: 'error', message: 'Database not initialised yet' });
    return;
  }
  const startTime = Date.now();
  try {
    const client = await sharedPool.connect();
    try {
      const result = await client.query('SELECT NOW() as time, current_database() as database');
      res.json({
        status: 'ok',
        database: {
          connected: true,
          name: result.rows[0].database,
          latency: `${Date.now() - startTime}ms`,
          timestamp: result.rows[0].time,
        },
        pool: {
          totalCount: sharedPool.totalCount,
          idleCount: sharedPool.idleCount,
          waitingCount: sharedPool.waitingCount,
        },
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: {
        connected: false,
        latency: `${Date.now() - startTime}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      pool: sharedPool
        ? {
            totalCount: sharedPool.totalCount,
            idleCount: sharedPool.idleCount,
            waitingCount: sharedPool.waitingCount,
          }
        : null,
    });
  }
});

// ---------------------------------------------------------------------------
// Webhook routes — BEFORE express.json() so raw body is captured for HMAC
// ---------------------------------------------------------------------------
app.use('/api', webhookRoutes);

// ---------------------------------------------------------------------------
// JSON body parser
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
app.use('/api', ...createRateLimiter());

// ---------------------------------------------------------------------------
// Pipeline routes — no auth required at route level
// ---------------------------------------------------------------------------
app.use('/api/pipeline', pipelineRoutes);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    await runMigrations({
      databaseUrl: env.DATABASE_URL,
      dir: __dirname + '/database/migrations',
      direction: 'up',
      verbose: env.NODE_ENV === 'development',
    });

    const optimizedDb = await setupOptimizedDatabase({
      connectionString: env.DATABASE_URL,
      enableMetrics: true,
      enableCache: true,
    });

    sharedPool = optimizedDb.pool.getPool();

    // Wire pool into services that need it
    setAuthPool(sharedPool);
    setTenantConfigPool(sharedPool);

    // Register pool-dependent routes NOW, after pool exists
    // These must be registered before notFoundHandler below
    app.use('/auth', authRoutes);
    app.use('/api', createChatRoutes(sharedPool));
    app.use('/api/tenant', tenantConfigRoutes);
    app.use('/api/dashboard', createDashboardRoutes(sharedPool));
    app.use(
      '/api/diagnostics',
      createDiagnosticsRouter({
        metricsCollector: optimizedDb.metrics ?? undefined,
        cacheManager: optimizedDb.cache ?? undefined,
        queryOptimizer: optimizedDb.optimizer ?? undefined,
        pool: optimizedDb.pool,
      })
    );

    // 404 and error handlers — MUST be last, registered here so they come
    // after all route registrations above
    app.use(notFoundHandler);
    app.use(errorHandler);

    if (env.ENABLE_AUDIT_LOGGING) {
      auditService = createAuditService(sharedPool, env.AUDIT_LOG_RETENTION_DAYS);

      // Run retention cleanup once per day.
      auditCleanupInterval = setInterval(
        async () => {
          if (!auditService) {
            return;
          }

          try {
            const deletedCount = await auditService.cleanOldLogs();
            if (deletedCount > 0) {
              console.log(`🧹 Audit cleanup removed ${deletedCount} old log(s)`);
            }
          } catch (error) {
            console.error('Audit cleanup failed:', error);
          }
        },
        24 * 60 * 60 * 1000
      );

      console.log('✅ Audit logging initialized');
    }

    const port = env.PORT;
    app.listen(port, env.HOST, () => {
      console.log(`🚀 Backend running on http://${env.HOST}:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Process-level safety nets
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err: Error) => {
  console.error('💥 uncaughtException — shutting down:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('💥 unhandledRejection — shutting down:', reason);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  console.log('Shutting down gracefully...');
  if (auditCleanupInterval) {
    clearInterval(auditCleanupInterval);
    auditCleanupInterval = null;
  }
  try {
    if (sharedPool) {
      await sharedPool.end();
      console.log('✅ Database pool closed');
    }
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
  try {
    await closeRedisClient();
    console.log('✅ Redis client closed');
  } catch (error) {
    console.error('Error closing Redis client:', error);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer();
