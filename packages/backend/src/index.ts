import express from 'express';
import { Pool } from 'pg';
import { runMigrations } from './database/migrate';
import { authRoutes } from './auth';
import { chatRoutes } from './chat';
import { pipelineRoutes } from './pipeline';
import { webhookRoutes } from './webhook';
import { createRateLimiter } from './rate-limit';
import { requestLogger } from './logger';
import { notFoundHandler, errorHandler } from './errors';

const app = express();

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

// Database connection for health checks
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/myapp',
  max: 2, // Minimal pool for health checks
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000,
});

// Auth routes
app.use('/auth', authRoutes);

// Chat routes (streaming AI chat with SSE)
app.use('/api', chatRoutes);

// Pipeline routes (file upload and processing)
app.use('/api/pipeline', pipelineRoutes);

// Basic health check (for load balancers)
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Database health check (for Docker, Fly.io, Kubernetes)
app.get('/health/db', async (_, res) => {
  const startTime = Date.now();

  try {
    // Test database connection
    const client = await pool.connect();
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

// Detailed health check (includes pool stats)
app.get('/health/detailed', async (_, res) => {
  const startTime = Date.now();

  try {
    const client = await pool.connect();
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
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
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
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
    });
  }
});

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
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/myapp';

    await runMigrations({
      databaseUrl,
      dir: __dirname + '/database/migrations',
      direction: 'up',
      verbose: process.env.NODE_ENV === 'development',
    });

    // Start Express server
    const port = parseInt(process.env.PORT || '3001', 10);
    app.listen(port, () => {
      console.log(`🚀 Backend running on :${port}`);
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

startServer();
