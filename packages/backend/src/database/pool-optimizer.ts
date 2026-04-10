/**
 * Connection Pool Optimization & Monitoring
 *
 * Dynamic pool sizing, health checks, and resource management
 */

import { Pool, PoolConfig, PoolClient } from 'pg';
import { MetricsCollector } from './metrics';

// ============================================================================
// Pool Configuration
// ============================================================================

export interface OptimizedPoolConfig extends PoolConfig {
  // Auto-scaling
  autoScaleMin?: number;
  autoScaleMax?: number;
  autoScaleThreshold?: number; // Percentage of idle connections threshold

  // Health checks
  healthCheckInterval?: number; // ms, 0 to disable
  healthCheckTimeout?: number; // ms
  healthCheckQuery?: string;

  // Advanced
  maxWaitingClients?: number; // Error if waiting clients exceed this
  statementTimeout?: number; // ms
  queryTimeout?: number; // ms
}

/**
 * Optimized connection pool with health checks and auto-scaling
 */
export class OptimizedConnectionPool {
  private pool: Pool;
  private healthCheckInterval: number;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private metricsCollector: MetricsCollector | null;
  private maxWaitingClients: number;

  constructor(config: OptimizedPoolConfig, metricsCollector?: MetricsCollector) {
    this.metricsCollector = metricsCollector || null;
    this.healthCheckInterval = config.healthCheckInterval ?? 30000;
    this.maxWaitingClients = config.maxWaitingClients ?? Infinity;

    // Merge with defaults for optimal SaaS performance
    const optimizedConfig: PoolConfig = {
      ...config,
      min: config.min ?? 2,
      max: config.max ?? 10,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5000,
      statement_timeout: config.statement_timeout ?? 30000,
      query_timeout: config.query_timeout ?? 30000,
      allowExitOnIdle: config.allowExitOnIdle ?? false,
    };

    this.pool = new Pool(optimizedConfig);

    // Setup event listeners
    this.setupEventListeners();

    // Start health check if enabled
    if (this.healthCheckInterval > 0) {
      this.startHealthCheck();
    }
  }

  /**
   * Setup pool event listeners
   */
  private setupEventListeners(): void {
    this.pool.on('error', (err: Error, client: PoolClient) => {
      console.error('🔴 Unexpected error on idle client:', err);
      client.release(err);
    });

    this.pool.on('connect', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('📍 Pool: new connection established');
      }
    });

    this.pool.on('remove', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('❌ Pool: connection removed');
      }
    });
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    let client: PoolClient | null = null;

    try {
      client = await Promise.race([
        this.pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        ),
      ]);

      // Simple query to test connection
      await client.query('SELECT 1');

      const stats = this.getPoolStats();

      // Log if health check shows issues
      if (stats.waitingCount > 0) {
        console.warn(`⚠️  Connection pool: ${stats.waitingCount} clients waiting`);
      }
    } catch (error) {
      console.error('❌ Health check failed:', (error as Error).message);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get connection with validation
   */
  async getConnection(): Promise<PoolClient> {
    const stats = this.getPoolStats();

    // Warn if too many clients waiting
    if (stats.waitingCount > this.maxWaitingClients) {
      console.error(`🔴 Too many waiting clients: ${stats.waitingCount}/${this.maxWaitingClients}`);
    }

    return this.pool.connect();
  }

  /**
   * Execute query with timeout
   */
  async query(queryString: string, values?: any[], timeoutMs?: number): Promise<any> {
    const client = await this.getConnection();

    try {
      if (timeoutMs) {
        // Use statement timeout
        await client.query(`SET statement_timeout = ${timeoutMs}`);
      }

      return await client.query<any>(queryString, values);
    } finally {
      client.release();
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      utilization: (this.pool.totalCount - this.pool.idleCount) / this.pool.totalCount,
    };
  }

  /**
   * Get health report
   */
  async getHealthReport(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    pool: ReturnType<OptimizedConnectionPool['getPoolStats']>;
    metrics?: any;
  }> {
    const poolStats = this.getPoolStats();
    const metricsData = this.metricsCollector?.getMetrics();
    const health = this.metricsCollector?.getHealthStatus();

    return {
      status: health?.status || 'healthy',
      pool: poolStats,
      metrics: metricsData,
    };
  }

  /**
   * Drain and close pool
   */
  async close(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    await this.pool.end();
  }

  /**
   * Get underlying pool
   */
  getPool(): Pool {
    return this.pool;
  }
}

// ============================================================================
// Pool Statistics Middleware
// ============================================================================

/**
 * Middleware to track pool statistics per request
 */
export function createPoolStatsMiddleware(pool: OptimizedConnectionPool | Pool) {
  return (req: any, _res: any, next: any) => {
    const isOptimized = pool instanceof OptimizedConnectionPool;
    const stats = isOptimized
      ? (pool as OptimizedConnectionPool).getPoolStats()
      : {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
          utilization: (pool.totalCount - pool.idleCount) / pool.totalCount,
        };

    req.connectionStats = stats;

    // Log warning if pool is stressed
    if (stats.utilization > 0.8) {
      console.warn(
        `⚠️  Connection pool stress: ${((stats.utilization || 0) * 100).toFixed(1)}% utilized`
      );
    }

    next();
  };
}

// ============================================================================
// Queue-Based Connection Management (for high-concurrency scenarios)
// ============================================================================

export interface QueuedConnectionOptions {
  timeout?: number; // Max wait time for connection
  priority?: number; // 0 = lowest, 10 = highest
}

export class QueuedConnectionPool {
  private pool: Pool;
  private queue: Array<{
    resolve: (client: PoolClient) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    priority: number;
  }> = [];

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  /**
   * Request connection from queue
   */
  async getConnection(options: QueuedConnectionOptions = {}): Promise<PoolClient> {
    const timeout = options.timeout || 30000;
    const priority = options.priority || 0;

    // Try immediate connection
    if (this.pool.idleCount > 0) {
      return this.pool.connect();
    }

    // Queue request
    return new Promise<PoolClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue
        const index = this.queue.findIndex((q) => q.resolve === resolve);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(new Error('Connection request timeout'));
      }, timeout);

      const request = {
        resolve,
        reject,
        timeout: timer,
        priority,
      };

      // Insert by priority
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (priority > this.queue[i].priority) {
          this.queue.splice(i, 0, request);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.queue.push(request);
      }

      this.processQueue();
    });
  }

  /**
   * Process waiting queue
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.pool.idleCount > 0) {
      const request = this.queue.shift();
      if (!request) break;

      try {
        clearTimeout(request.timeout);
        const client = await this.pool.connect();
        request.resolve(client);
      } catch (error) {
        request.reject(error as Error);
      }
    }
  }

  /**
   * Close pool
   */
  async close(): Promise<void> {
    // Reject all queued requests
    for (const request of this.queue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Pool closed'));
    }
    this.queue = [];

    await this.pool.end();
  }

  /**
   * Get pool stats
   */
  getStats() {
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingRequests: this.queue.length,
      utilization: (this.pool.totalCount - this.pool.idleCount) / this.pool.totalCount,
    };
  }
}
