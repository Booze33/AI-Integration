/**
 * Redis Queue Service
 *
 * Manages async job processing using BullMQ with:
 * - Job creation and tracking
 * - Progress updates
 * - Error handling and retries
 * - Job status monitoring
 * - Dead letter queue for failed jobs
 * - Real-time job status updates via SSE
 */

import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { PipelineJob, JobStatus, QueueJobData, QueueJobResult } from './types';
import { TextExtractionService } from './extraction';
import { TextChunkingService } from './chunking';
import { resolveRedisConfigFromEnv } from '../redis/config';

/**
 * Queue configuration
 */
interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  defaultJobOptions: {
    attempts: number;
    backoff: {
      type: 'fixed' | 'exponential';
      delay: number;
    };
    removeOnComplete: number;
    removeOnFail: number;
  };
  concurrency: number;
  enableDeadLetterQueue: boolean;
}

/**
 * Default queue configuration
 */
const DEFAULT_CONFIG: QueueConfig = {
  redis: resolveRedisConfigFromEnv(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
  concurrency: 5,
  enableDeadLetterQueue: true,
};

/**
 * Redis Queue Service
 */
export class QueueService {
  private queue: Queue<QueueJobData>;
  private deadLetterQueue: Queue<QueueJobData>;
  private worker!: Worker<QueueJobData, QueueJobResult>;
  private queueEvents: QueueEvents;
  private extractionService: TextExtractionService;
  private chunkingService: TextChunkingService;
  private jobs: Map<string, PipelineJob>;
  private statusListeners: Map<string, Set<(status: PipelineJob) => void>>;
  private ready = false;
  private lastReadyError: string | null = null;
  private readyPromise!: Promise<void>;

  constructor(config: Partial<QueueConfig> = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    this.queue = new Queue<QueueJobData>('file-processing', {
      connection: fullConfig.redis,
      defaultJobOptions: fullConfig.defaultJobOptions,
    });

    this.deadLetterQueue = new Queue<QueueJobData>('file-processing-dead-letter', {
      connection: fullConfig.redis,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });

    this.queueEvents = new QueueEvents('file-processing', {
      connection: fullConfig.redis,
    });

    this.extractionService = new TextExtractionService();
    this.chunkingService = new TextChunkingService();
    this.jobs = new Map();
    this.statusListeners = new Map();

    this.setupWorker(fullConfig.concurrency);
    this.setupEventHandlers();
    this.readyPromise = this.initializeConnections();
  }

  /**
   * Attempt to initialize all BullMQ connections.
   */
  private async initializeConnections(): Promise<void> {
    try {
      await Promise.all([
        this.queue.waitUntilReady(),
        this.deadLetterQueue.waitUntilReady(),
        this.queueEvents.waitUntilReady(),
        this.worker.waitUntilReady(),
      ]);
      this.ready = true;
      this.lastReadyError = null;
    } catch (error) {
      this.ready = false;
      this.lastReadyError =
        error instanceof Error ? error.message : 'Unknown queue connection error';
      throw error;
    }
  }

  /**
   * Ensure queue is ready before accepting operations.
   */
  async waitUntilReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    try {
      await this.readyPromise;
    } catch {
      // Retry on demand so queue can recover after startup Redis outage.
      this.readyPromise = this.initializeConnections();
      try {
        await this.readyPromise;
      } catch {
        throw new Error(
          `Queue is not ready. Redis may be unavailable. ${this.lastReadyError || ''}`.trim()
        );
      }
    }
  }

  /**
   * Queue health status for diagnostics and health endpoints.
   */
  getHealthStatus(): {
    ready: boolean;
    lastError: string | null;
  } {
    return {
      ready: this.ready,
      lastError: this.lastReadyError,
    };
  }

  /**
   * Setup worker for job processing
   */
  private setupWorker(concurrency: number): void {
    this.worker = new Worker<QueueJobData, QueueJobResult>(
      'file-processing',
      async (job: Job<QueueJobData>): Promise<QueueJobResult> => {
        const { jobId, fileId, filePath, mimeType, options } = job.data;

        try {
          // Update status to extracting
          await this.updateJobStatus(jobId, 'extracting', 10);

          // Extract text from file
          const extractionResult = await this.extractionService.extractTextWithProgress(
            fileId,
            filePath,
            mimeType,
            (progress) => this.updateJobProgress(jobId, 10 + progress * 0.4)
          );

          // Update status to chunking
          await this.updateJobStatus(jobId, 'chunking', 50);

          // Chunk the extracted text
          const chunkingService = new TextChunkingService(options.chunkSize, options.chunkOverlap);
          const chunks = chunkingService.chunkTextWithSentences(fileId, extractionResult.text);

          // Update progress
          await this.updateJobProgress(jobId, 90);

          // Update status to processing
          await this.updateJobStatus(jobId, 'processing', 90);

          // Store chunks in job
          const jobData = this.jobs.get(jobId);
          if (jobData) {
            jobData.chunks = chunks;
            jobData.progress = 100;
            jobData.status = 'completed';
            jobData.completedAt = new Date();
            jobData.updatedAt = new Date();
          }

          // Update status to completed
          await this.updateJobStatus(jobId, 'completed', 100);

          return {
            jobId,
            success: true,
            chunks,
          };
        } catch (error) {
          // Update status to failed
          await this.updateJobStatus(
            jobId,
            'failed',
            0,
            error instanceof Error ? error.message : 'Unknown error'
          );

          // Move to dead letter queue if enabled
          if (this.deadLetterQueue) {
            await this.moveToDeadLetterQueue(job, error);
          }

          return {
            jobId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      {
        connection: this.queue.opts.connection,
        concurrency,
      }
    );
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.queueEvents.on('completed', ({ jobId, returnvalue: _returnvalue }) => {
      console.log(`Job ${jobId} completed successfully`);
      this.notifyStatusListeners(jobId, 'completed');
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Job ${jobId} failed:`, failedReason);
      this.notifyStatusListeners(jobId, 'failed');
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      const progress = typeof data === 'number' ? data : 0;
      this.updateJobProgress(jobId, progress);
      this.notifyStatusListeners(jobId, 'processing');
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      console.warn(`Job ${jobId} stalled`);
    });
  }

  /**
   * Move job to dead letter queue
   */
  private async moveToDeadLetterQueue(job: Job<QueueJobData>, error: unknown): Promise<void> {
    try {
      await this.deadLetterQueue.add(
        `dead-letter-${job.id}`,
        {
          ...job.data,
          originalJobId: job.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          failedAt: new Date().toISOString(),
        },
        {
          attempts: 0,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );
      console.log(`Job ${job.id} moved to dead letter queue`);
    } catch (dlqError) {
      console.error(`Failed to move job ${job.id} to dead letter queue:`, dlqError);
    }
  }

  /**
   * Subscribe to job status updates
   */
  subscribeToStatus(jobId: string, listener: (status: PipelineJob) => void): () => void {
    if (!this.statusListeners.has(jobId)) {
      this.statusListeners.set(jobId, new Set());
    }
    this.statusListeners.get(jobId)!.add(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.statusListeners.get(jobId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.statusListeners.delete(jobId);
        }
      }
    };
  }

  /**
   * Notify status listeners
   */
  private notifyStatusListeners(jobId: string, _status: JobStatus): void {
    const listeners = this.statusListeners.get(jobId);
    if (listeners) {
      const job = this.jobs.get(jobId);
      if (job) {
        listeners.forEach((listener) => listener(job));
      }
    }
  }

  /**
   * Get dead letter queue jobs
   */
  async getDeadLetterJobs(): Promise<Job<QueueJobData>[]> {
    await this.waitUntilReady();
    return await this.deadLetterQueue.getJobs(['failed']);
  }

  /**
   * Retry a job from dead letter queue
   */
  async retryDeadLetterJob(jobId: string): Promise<boolean> {
    try {
      await this.waitUntilReady();
      const job = await this.deadLetterQueue.getJob(jobId);
      if (!job) {
        return false;
      }

      // Re-add to main queue
      await this.queue.add('retry-job', job.data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      });

      // Remove from dead letter queue
      await job.remove();
      return true;
    } catch (error) {
      console.error(`Failed to retry dead letter job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Add a new job to the queue
   */
  async addJob(
    fileId: string,
    filePath: string,
    mimeType: string,
    options: {
      chunkSize?: number;
      chunkOverlap?: number;
    } = {}
  ): Promise<PipelineJob> {
    await this.waitUntilReady();

    const jobId = `job-${fileId}-${Date.now()}`;

    const jobData: PipelineJob = {
      id: jobId,
      fileId,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, jobData);

    const queueData: QueueJobData = {
      jobId,
      fileId,
      filePath,
      mimeType,
      options: {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
      },
    };

    await this.queue.add('file-processing', queueData);

    return jobData;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): PipelineJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): PipelineJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): PipelineJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  /**
   * Update job status
   */
  private async updateJobStatus(
    jobId: string,
    status: JobStatus,
    progress: number,
    error?: string
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      job.progress = progress;
      job.updatedAt = new Date();
      if (error) {
        job.error = error;
      }
      if (status === 'completed' || status === 'failed') {
        job.completedAt = new Date();
      }
    }
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(jobId: string, progress: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, progress));
      job.updatedAt = new Date();
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    await this.waitUntilReady();

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Clean up old jobs
   */
  async cleanOldJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - olderThanMs;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt.getTime() < cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }

  /**
   * Close the queue
   */
  async close(): Promise<void> {
    await Promise.all([
      this.worker.close(),
      this.queueEvents.close(),
      this.deadLetterQueue.close(),
      this.queue.close(),
    ]);
  }
}

/**
 * Create queue service
 */
export function createQueueService(config?: Partial<QueueConfig>): QueueService {
  return new QueueService(config);
}
