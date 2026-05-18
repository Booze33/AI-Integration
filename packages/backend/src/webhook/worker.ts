/**
 * Webhook Worker Service
 *
 * Consumes jobs from the webhook queue and performs provider-specific handling.
 * This keeps webhook ingestion fast while shifting processing to async workers.
 */

import { Job, QueueEvents, Worker } from 'bullmq';
import { resolveRedisConfigFromEnv } from '../redis/config';
import { WEBHOOK_QUEUE_NAME } from './queue';
import { WebhookJobData, WebhookJobResult } from './types';

const DEFAULT_CONCURRENCY = Number(process.env.WEBHOOK_WORKER_CONCURRENCY || 5);

export interface WebhookWorkerHealth {
  ready: boolean;
  lastError: string | null;
}

export interface WebhookEventProcessor {
  process(job: WebhookJobData): Promise<void>;
}

class DefaultWebhookEventProcessor implements WebhookEventProcessor {
  async process(job: WebhookJobData): Promise<void> {
    const provider = job.provider.toLowerCase();

    switch (provider) {
      case 'github':
        await this.handleGitHub(job);
        return;
      case 'stripe':
        await this.handleStripe(job);
        return;
      case 'gitlab':
        await this.handleGitLab(job);
        return;
      case 'generic':
        await this.handleGeneric(job);
        return;
      default:
        // Unknown providers should not fail retries forever.
        console.warn(`[webhook-worker] Unsupported provider: ${job.provider} (${job.id})`);
    }
  }

  private async handleGitHub(job: WebhookJobData): Promise<void> {
    this.logProcessing(job, ['push', 'pull_request', 'issues']);
  }

  private async handleStripe(job: WebhookJobData): Promise<void> {
    this.logProcessing(job, [
      'payment_intent.succeeded',
      'invoice.paid',
      'customer.subscription.updated',
    ]);
  }

  private async handleGitLab(job: WebhookJobData): Promise<void> {
    this.logProcessing(job, ['Push Hook', 'Merge Request Hook']);
  }

  private async handleGeneric(job: WebhookJobData): Promise<void> {
    this.logProcessing(job);
  }

  private logProcessing(job: WebhookJobData, notableEvents: string[] = []): void {
    const bodySummary =
      job.body && typeof job.body === 'object'
        ? `keys=${Object.keys(job.body as Record<string, unknown>).length}`
        : `type=${typeof job.body}`;

    const notable = notableEvents.includes(job.event) ? ' (notable event)' : '';

    console.log(
      `[webhook-worker] processed id=${job.id} provider=${job.provider} event=${job.event}${notable} deliveryId=${job.deliveryId || 'n/a'} ${bodySummary}`
    );
  }
}

export class WebhookWorkerService {
  private worker: Worker<WebhookJobData, WebhookJobResult>;
  private queueEvents: QueueEvents;
  private ready = false;
  private lastReadyError: string | null = null;
  private readyPromise: Promise<void>;
  private processor: WebhookEventProcessor;

  constructor(processor: WebhookEventProcessor = new DefaultWebhookEventProcessor()) {
    this.processor = processor;

    this.worker = new Worker<WebhookJobData, WebhookJobResult>(
      WEBHOOK_QUEUE_NAME,
      async (job: Job<WebhookJobData>): Promise<WebhookJobResult> => {
        await this.processor.process(job.data);
        return {
          id: job.data.id,
          processed: true,
        };
      },
      {
        connection: resolveRedisConfigFromEnv(),
        concurrency: Number.isFinite(DEFAULT_CONCURRENCY) ? DEFAULT_CONCURRENCY : 5,
      }
    );

    this.queueEvents = new QueueEvents(WEBHOOK_QUEUE_NAME, {
      connection: resolveRedisConfigFromEnv(),
    });

    this.setupEventHandlers();
    this.readyPromise = this.initializeConnections();
  }

  private setupEventHandlers(): void {
    this.worker.on('failed', (job, error) => {
      const id = job?.id || 'unknown';
      console.error(`[webhook-worker] job failed id=${id}:`, error);
    });

    this.worker.on('error', (error) => {
      this.ready = false;
      this.lastReadyError = error.message;
      console.error('[webhook-worker] worker error:', error);
    });

    this.queueEvents.on('completed', ({ jobId }) => {
      console.log(`[webhook-worker] job completed id=${jobId}`);
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`[webhook-worker] job failed id=${jobId}: ${failedReason}`);
    });
  }

  private async initializeConnections(): Promise<void> {
    try {
      await Promise.all([this.worker.waitUntilReady(), this.queueEvents.waitUntilReady()]);
      this.ready = true;
      this.lastReadyError = null;
    } catch (error) {
      this.ready = false;
      this.lastReadyError =
        error instanceof Error ? error.message : 'Unknown worker connection error';
      throw error;
    }
  }

  async waitUntilReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    try {
      await this.readyPromise;
    } catch {
      this.readyPromise = this.initializeConnections();
      try {
        await this.readyPromise;
      } catch {
        throw new Error(
          `Webhook worker is not ready. Redis may be unavailable. ${this.lastReadyError || ''}`.trim()
        );
      }
    }
  }

  getHealthStatus(): WebhookWorkerHealth {
    return {
      ready: this.ready,
      lastError: this.lastReadyError,
    };
  }

  async close(): Promise<void> {
    await Promise.all([this.worker.close(), this.queueEvents.close()]);
    this.ready = false;
  }
}

let workerInstance: WebhookWorkerService | null = null;

export function getWebhookWorkerService(): WebhookWorkerService {
  if (!workerInstance) {
    workerInstance = new WebhookWorkerService();
  }
  return workerInstance;
}

export async function closeWebhookWorkerService(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
