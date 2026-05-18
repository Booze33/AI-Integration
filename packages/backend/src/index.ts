import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import type { Socket } from 'net';
import { Pool } from 'pg';
import { setupOptimizedDatabase } from './database';
import { createDiagnosticsRouter } from './database/diagnostics';
import { runMigrations } from './database/migrate';
import { authRoutes, setAuthPool } from './auth';
import { validateJwtKeys } from './auth/jwt';
import { createChatRoutes } from './chat';
import { registerChatWebSocket } from './chat/websocket';
import { pipelineRoutes } from './pipeline';
import { webhookRoutes } from './webhook';
import { getWebhookWorkerService, closeWebhookWorkerService } from './webhook/worker';
import { tenantConfigRoutes, setTenantConfigPool } from './providers/routes';
import { createDashboardRoutes } from './dashboard/routes';
import { createUsageCapsRoutes } from './usage-caps';
import { createRateLimiter } from './rate-limit';
import { requestLogger } from './logger';
import { notFoundHandler, errorHandler } from './errors';
import { securityHeadersMiddleware } from './security';
import { closeRedisClient, getRedisClientHealth } from './redis/client';
import { getPipelineService } from './pipeline/singleton';
import {
  validateEnv,
  printEnvConfig,
  getClientInfo,
  AuditService,
  createAuditService,
  startAuditCleanupJob,
} from './audit';

// ---------------------------------------------------------------------------
// Validate environment variables on startup
// ---------------------------------------------------------------------------
const env = validateEnv();
printEnvConfig();

// Validate JWT keys are present before accepting any requests
validateJwtKeys();

const app = express();
let sharedPool: Pool | null = null;
let auditService: AuditService | null = null;
let auditCleanupInterval: NodeJS.Timeout | null = null;
let httpServer: HttpServer | null = null;
const openSockets = new Set<Socket>();
let webhookWorkerCreated = false;
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000);
const allowedCorsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function getUnifiedRedisHealth() {
  const singleton = getRedisClientHealth();
  const queue = getPipelineService().getQueueHealth();

  return {
    ready: singleton.ready && queue.ready,
    singleton,
    queue,
  };
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(securityHeadersMiddleware);

// ---------------------------------------------------------------------------
// CORS — before everything else
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;

  if (!requestOrigin || allowedCorsOrigins.includes('*')) {
    next();
    return;
  }

  if (!allowedCorsOrigins.includes(requestOrigin)) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Origin is not allowed by CORS policy',
    });
    return;
  }

  next();
});

app.use(
  cors({
    origin: allowedCorsOrigins,
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

app.get('/health/redis', (_req, res) => {
  const redis = getUnifiedRedisHealth();

  if (!redis.ready) {
    res.status(503).json({
      status: 'error',
      redis,
    });
    return;
  }

  res.json({
    status: 'ok',
    redis,
  });
});

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
        redis: getUnifiedRedisHealth(),
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
      redis: getUnifiedRedisHealth(),
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
    app.use('/api/tenant/usage-caps', createUsageCapsRoutes(sharedPool));
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
      auditCleanupInterval = startAuditCleanupJob(auditService);

      console.log('✅ Audit logging initialized');
    }

    // Start webhook worker in-process so webhook jobs are consumed end-to-end.
    // Route handlers enqueue jobs immediately; this worker processes them asynchronously.
    const webhookWorker = getWebhookWorkerService();
    webhookWorkerCreated = true;
    webhookWorker
      .waitUntilReady()
      .then(() => {
        console.log('✅ Webhook worker initialized');
      })
      .catch((error) => {
        console.error('⚠️ Webhook worker is not ready:', error);
      });

    const port = env.PORT;
    httpServer = createServer(app);
    registerChatWebSocket(httpServer, sharedPool!);

    httpServer.on('connection', (socket: Socket) => {
      openSockets.add(socket);
      socket.on('close', () => {
        openSockets.delete(socket);
      });
    });

    httpServer.listen(port, env.HOST, () => {
      console.log(`🚀 Backend running on http://${env.HOST}:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🔌 WebSocket chat: ws://${env.HOST}:${port}/ws/chat`);
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
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log('Shutting down gracefully...');

  if (httpServer) {
    const serverRef = httpServer;
    const closeServerPromise = new Promise<void>((resolve, reject) => {
      serverRef.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    let shutdownTimer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      shutdownTimer = setTimeout(() => {
        resolve('timeout');
      }, SHUTDOWN_TIMEOUT_MS);
    });

    try {
      const closeResult = await Promise.race([
        closeServerPromise.then(() => 'closed' as const),
        timeoutPromise,
      ]);

      if (closeResult === 'timeout') {
        console.warn(
          `⚠️ Server did not close within ${SHUTDOWN_TIMEOUT_MS}ms, destroying open sockets...`
        );
        for (const socket of openSockets) {
          socket.destroy();
        }
        await closeServerPromise;
      }

      console.log('✅ HTTP server closed');
    } catch (error) {
      console.error('Error closing HTTP server:', error);
    } finally {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      httpServer = null;
      openSockets.clear();
    }
  }

  if (auditCleanupInterval) {
    clearInterval(auditCleanupInterval);
    auditCleanupInterval = null;
  }
  try {
    if (webhookWorkerCreated) {
      await closeWebhookWorkerService();
      console.log('✅ Webhook worker closed');
    }
  } catch (error) {
    console.error('Error closing webhook worker:', error);
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
