import 'dotenv/config'; // ← must be the very first import
import cors from 'cors';
import express from 'express';
import { Pool } from 'pg';
import { setupOptimizedDatabase } from './database';
import { runMigrations } from './database/migrate';
import { authRoutes, setAuthPool } from './auth';
import { createChatRoutes } from './chat';
import { pipelineRoutes } from './pipeline';
import { webhookRoutes } from './webhook';
import { tenantConfigRoutes, setTenantConfigPool } from './providers/routes';
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
let pool: Pool | null = null;

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: env.CORS_CREDENTIALS,
  })
);

// Global audit service (injected into requests for tracking)
let auditService: AuditService | null = null;

// ---------------------------------------------------------------------------
// Request logger — MUST be the first middleware so every request receives a
// correlation ID (req.requestId / X-Request-ID header) before anything else
// runs.  Skip high-frequency health-check paths to reduce noise.
// ---------------------------------------------------------------------------
app.use(
  requestLogger({
    skip: (req) => req.path === '/health',
  })
);

// ---------------------------------------------------------------------------
// Audit logging middleware — attach audit service and client info to request
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (auditService) {
    (req as any).auditService = auditService;
    (req as any).clientInfo = getClientInfo(req);
  }
  next();
});

// ---------------------------------------------------------------------------
// Webhook routes — must be mounted BEFORE express.json() so that the
// router-level express.raw() middleware can capture the raw body bytes
// required for HMAC signature verification.
// ---------------------------------------------------------------------------
app.use('/api', webhookRoutes);

// Global JSON body parser (for all other routes)
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting — applied after JSON parsing so req.user / req.tenantId are
// available when auth middleware has already run.  The three scopes
// (user › tenant › IP) are evaluated independently for each request.
// Configure limits via RATE_LIMIT_* environment variables.
// ---------------------------------------------------------------------------
app.use('/api', ...createRateLimiter());

function registerDatabaseRoutes(sharedPool: Pool) {
  pool = sharedPool;
  setAuthPool(sharedPool);
  setTenantConfigPool(sharedPool);

  app.use('/auth', authRoutes);
  app.use('/api', createChatRoutes(sharedPool));
  app.use('/api/tenant', tenantConfigRoutes);

  app.get('/health', (_, res) => res.json({ status: 'ok' }));

  app.get('/health/db', async (_, res) => {
    const startTime = Date.now();

    try {
      // Test database connection
      const client = await sharedPool.connect();
      try {
        // Run a simple query to verify connection
        const result = await client.query('SELECT NOW() as time, current_database() as database');
        const latency = Date.now() - startTime;

        res.json({
          status: 'ok',
          database: {
            connected: true,
            name: result.rows[0].database,
            latency: `${latency}ms`,
            timestamp: result.rows[0].time,
          },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      const latency = Date.now() - startTime;

      res.status(503).json({
        status: 'error',
        database: {
          connected: false,
          latency: `${latency}ms`,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });

  app.get('/health/detailed', async (_, res) => {
    const startTime = Date.now();

    try {
      const client = await sharedPool.connect();
      try {
        const result = await client.query('SELECT NOW() as time, current_database() as database');
        const latency = Date.now() - startTime;

        res.json({
          status: 'ok',
          database: {
            connected: true,
            name: result.rows[0].database,
            latency: `${latency}ms`,
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
      const latency = Date.now() - startTime;

      res.status(503).json({
        status: 'error',
        database: {
          connected: false,
          latency: `${latency}ms`,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        pool: {
          totalCount: sharedPool.totalCount,
          idleCount: sharedPool.idleCount,
          waitingCount: sharedPool.waitingCount,
        },
      });
    }
  });
}

// Pipeline routes (file upload and processing)
app.use('/api/pipeline', pipelineRoutes);

// ---------------------------------------------------------------------------
// Error handling — MUST come after all routes
// ---------------------------------------------------------------------------

// 404 — catches any request that didn't match a route above
app.use(notFoundHandler);

// Global error handler — formats all thrown errors as structured JSON.
// Never leaks stack traces in production.
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server with automatic migrations
// ---------------------------------------------------------------------------

async function startServer() {
  try {
    // Run database migrations on startup
    const databaseUrl = env.DATABASE_URL;

    await runMigrations({
      databaseUrl,
      dir: __dirname + '/database/migrations',
      direction: 'up',
      verbose: env.NODE_ENV === 'development',
    });

    const optimizedDb = await setupOptimizedDatabase({
      connectionString: databaseUrl,
      enableMetrics: true,
      enableCache: true,
    });
    const sharedPool = optimizedDb.pool.getPool();
    registerDatabaseRoutes(sharedPool);

    // Initialize audit service if enabled
    if (env.ENABLE_AUDIT_LOGGING) {
      auditService = createAuditService(sharedPool);
      console.log('✅ Audit logging initialized');
    }

    // Start Express server
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
// These catch errors that escape all try/catch and async boundaries.
// Log and exit — never silently swallow them.
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

  try {
    if (pool) {
      await pool.end();
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
