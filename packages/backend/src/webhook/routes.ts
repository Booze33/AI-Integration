/**
 * Webhook Routes
 *
 * POST /api/webhooks/:provider
 *   1. Capture raw body bytes (needed for HMAC verification).
 *   2. Verify the provider's signature header (reject 401 if invalid).
 *   3. Enqueue a BullMQ job.
 *   4. Return 200 immediately — all heavy processing is async.
 *
 * GET /api/webhooks/health
 *   Returns the list of supported providers and service status.
 *
 * IMPORTANT: mount this router BEFORE express.json() in your app so that
 * express.raw() can capture the raw body before any JSON parsing occurs.
 */

import express, { NextFunction, Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { WebhookQueueService } from './queue';
import { verifyGitHub, verifyGitLab, verifyHmac, verifyStripe } from './verifiers';
import { ProviderConfig } from './types';

// ---------------------------------------------------------------------------
// Augment Express Request with rawBody
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Raw body bytes captured before JSON parsing */
      rawBody?: Buffer;
    }
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const PROVIDERS: Readonly<Record<string, ProviderConfig>> = {
  github: {
    name: 'GitHub',
    signatureHeader: 'x-hub-signature-256',
    verify: verifyGitHub,
    secretEnvKey: 'GITHUB_WEBHOOK_SECRET',
  },
  stripe: {
    name: 'Stripe',
    signatureHeader: 'stripe-signature',
    verify: verifyStripe,
    secretEnvKey: 'STRIPE_WEBHOOK_SECRET',
  },
  gitlab: {
    name: 'GitLab',
    signatureHeader: 'x-gitlab-token',
    verify: verifyGitLab,
    secretEnvKey: 'GITLAB_WEBHOOK_SECRET',
  },
  generic: {
    name: 'Generic',
    signatureHeader: 'x-webhook-signature',
    verify: verifyHmac,
    secretEnvKey: 'GENERIC_WEBHOOK_SECRET',
  },
};

// ---------------------------------------------------------------------------
// Body-parsing middleware (scoped to this router)
// ---------------------------------------------------------------------------

/**
 * Capture the raw request body as a Buffer and store it on `req.rawBody`.
 * We use express.raw() instead of express.json() so that signature
 * verification always operates on the exact bytes that were sent.
 */
const captureRawBody = express.raw({ type: '*/*', limit: '1mb' });

/**
 * After captureRawBody, req.body is a Buffer (or empty object {}).
 * This middleware converts the Buffer to req.rawBody and re-parses it as JSON
 * into req.body so downstream handlers get a plain object as usual.
 */
function parseJsonAfterRaw(req: Request, _res: Response, next: NextFunction): void {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString('utf8')) as unknown;
    } catch {
      req.body = {};
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// Shared queue instance
// ---------------------------------------------------------------------------

const webhookQueue = new WebhookQueueService();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router: Router = Router();

/**
 * POST /api/webhooks/:provider
 *
 * Verify → Enqueue → 200.
 * The entire path from receiving the request to sending the response must be
 * as fast as possible so the provider does not time out or retry.
 */
router.post(
  '/webhooks/:provider',
  captureRawBody,
  parseJsonAfterRaw,
  async (req: Request, res: Response): Promise<void> => {
    const { provider } = req.params;
    const config = PROVIDERS[provider.toLowerCase()];

    // -----------------------------------------------------------------------
    // 1. Validate provider
    // -----------------------------------------------------------------------
    if (!config) {
      res.status(400).json({
        error: 'Unsupported provider',
        message: `Unknown webhook provider: "${provider}"`,
        supportedProviders: Object.keys(PROVIDERS),
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Signature verification
    // -----------------------------------------------------------------------
    const secret = process.env[config.secretEnvKey] ?? '';
    const signature = req.headers[config.signatureHeader] as string | undefined;

    if (secret) {
      // Secret is configured — signature is mandatory
      if (!signature) {
        res.status(401).json({
          error: 'Missing signature',
          message: `Expected the "${config.signatureHeader}" header`,
        });
        return;
      }

      // Fall back to stringified body when raw bytes are somehow unavailable
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body), 'utf8');

      const valid = config.verify(rawBody, signature, secret, req);
      if (!valid) {
        res.status(401).json({
          error: 'Invalid signature',
          message: 'Webhook signature verification failed',
        });
        return;
      }
    }
    // If no secret is configured, signature verification is skipped.
    // Useful during local development; always set secrets in production.

    // -----------------------------------------------------------------------
    // 3. Build job payload
    // -----------------------------------------------------------------------
    const jobId = randomUUID();

    // Extract event type — each provider uses a different header / body field
    const event =
      (req.headers['x-github-event'] as string | undefined) ||
      (req.headers['x-gitlab-event'] as string | undefined) ||
      (typeof req.body === 'object' &&
        req.body !== null &&
        ((req.body as Record<string, unknown>)['type'] as string | undefined)) ||
      'unknown';

    const deliveryId =
      (req.headers['x-github-delivery'] as string | undefined) ||
      (req.headers['x-request-id'] as string | undefined) ||
      jobId;

    // -----------------------------------------------------------------------
    // 4. Enqueue — then return 200 immediately
    // -----------------------------------------------------------------------
    try {
      await webhookQueue.enqueue({
        id: jobId,
        provider: config.name,
        event,
        deliveryId,
        timestamp: new Date().toISOString(),
        // Omit sensitive / oversized headers from the job payload
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
      });

      res.status(200).json({
        received: true,
        jobId,
        provider: config.name,
        event,
      });
    } catch (err) {
      console.error('[webhook] Failed to enqueue job:', err);
      res.status(500).json({
        error: 'Queue error',
        message: err instanceof Error ? err.message : 'Failed to enqueue webhook',
      });
    }
  }
);

/**
 * GET /api/webhooks/health
 *
 * Lightweight health check — returns supported providers list.
 */
router.get('/webhooks/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'webhook',
    providers: Object.keys(PROVIDERS),
    timestamp: new Date().toISOString(),
  });
});

export { router as webhookRoutes };
