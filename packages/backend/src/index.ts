import express from 'express';
import { Pool } from 'pg';
import { runMigrations } from './database/migrate';

const app = express();

// Database connection for health checks
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/myapp',
  max: 2, // Minimal pool for health checks
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000,
});

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

// Start server with automatic migrations
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

startServer();
