/**
 * Webhook Handler Tests
 *
 * Strategy:
 *  - Mock WebhookQueueService so no Redis connection is needed.
 *  - Build a minimal Express app that mounts webhookRoutes exactly as
 *    src/index.ts does (BEFORE express.json()).
 *  - Drive every code-path with supertest.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mock WebhookQueueService before importing routes.
//
// vi.mock() is hoisted to the top of the file by Vitest, so any variables
// referenced inside the factory must themselves be hoisted via vi.hoisted().
// Vitest 4.x also requires the mock constructor to use `function` or `class`
// syntax (not an arrow function) when mocking a class.
// ---------------------------------------------------------------------------

const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue('test-job-id'));

vi.mock('../queue', () => ({
  // Use `class` syntax so `new WebhookQueueService()` works as a constructor
  WebhookQueueService: class {
    enqueue = mockEnqueue;
    close = vi.fn().mockResolvedValue(undefined);
  },
  WEBHOOK_QUEUE_NAME: 'webhook-events',
}));

// Import AFTER mocking
import { webhookRoutes, PROVIDERS } from '../routes';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  // Webhook routes BEFORE express.json() — exactly like src/index.ts
  app.use('/api', webhookRoutes);
  app.use(express.json());
  return app;
}

/** Compute a valid GitHub HMAC-SHA256 signature */
function githubSig(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Compute a valid Stripe Stripe-Signature header value */
function stripeSig(body: string, secret: string, tsOverride?: number): string {
  const ts = tsOverride ?? Math.floor(Date.now() / 1000);
  const signed = `${ts}.${body}`;
  const v1 = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${ts},v1=${v1}`;
}

/** Compute a valid GitLab token */
function gitlabToken(secret: string): string {
  return secret;
}

/** Compute a valid generic HMAC signature */
function genericSig(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GITHUB_SECRET = 'gh-test-secret';
const STRIPE_SECRET = 'stripe-test-secret';
const GITLAB_SECRET = 'gl-test-secret';
const GENERIC_SECRET = 'generic-test-secret';

const sampleBody = JSON.stringify({ action: 'opened', number: 1 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Webhook Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = buildApp();
    mockEnqueue.mockClear();
    // Clear provider secrets between tests
    delete process.env['GITHUB_WEBHOOK_SECRET'];
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    delete process.env['GITLAB_WEBHOOK_SECRET'];
    delete process.env['GENERIC_WEBHOOK_SECRET'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /api/webhooks/health
  // -------------------------------------------------------------------------

  describe('GET /api/webhooks/health', () => {
    it('returns 200 with supported providers list', async () => {
      const res = await request(app).get('/api/webhooks/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('webhook');
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers).toEqual(expect.arrayContaining(['github', 'stripe', 'gitlab']));
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/:provider — unknown provider
  // -------------------------------------------------------------------------

  describe('POST /api/webhooks/:provider — unknown provider', () => {
    it('returns 400 for an unsupported provider', async () => {
      const res = await request(app)
        .post('/api/webhooks/unknown-provider')
        .send(sampleBody)
        .expect(400);

      expect(res.body.error).toBe('Unsupported provider');
      expect(res.body.supportedProviders).toEqual(expect.arrayContaining(['github', 'stripe']));
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/github
  // -------------------------------------------------------------------------

  describe('POST /api/webhooks/github', () => {
    it('returns 200 and enqueues job when no secret is configured', async () => {
      // No GITHUB_WEBHOOK_SECRET set → signature check skipped
      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'abc-123')
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.jobId).toBeDefined();
      expect(res.body.provider).toBe('GitHub');
      expect(res.body.event).toBe('push');
      expect(mockEnqueue).toHaveBeenCalledOnce();

      const enqueueArg = mockEnqueue.mock.calls[0][0];
      expect(enqueueArg.provider).toBe('GitHub');
      expect(enqueueArg.event).toBe('push');
      expect(enqueueArg.deliveryId).toBe('abc-123');
    });

    it('returns 401 when secret is set but signature header is missing', async () => {
      process.env['GITHUB_WEBHOOK_SECRET'] = GITHUB_SECRET;

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Missing signature');
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 401 for an invalid GitHub signature', async () => {
      process.env['GITHUB_WEBHOOK_SECRET'] = GITHUB_SECRET;

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=badhash')
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('returns 200 and enqueues job for a valid GitHub signature', async () => {
      process.env['GITHUB_WEBHOOK_SECRET'] = GITHUB_SECRET;

      const sig = githubSig(sampleBody, GITHUB_SECRET);

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', sig)
        .set('x-github-event', 'pull_request')
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.event).toBe('pull_request');
      expect(mockEnqueue).toHaveBeenCalledOnce();
    });

    it('is case-insensitive for the provider name in the URL', async () => {
      const res = await request(app)
        .post('/api/webhooks/GitHub')
        .set('Content-Type', 'application/json')
        .send(sampleBody)
        .expect(200);

      expect(res.body.provider).toBe('GitHub');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/stripe
  // -------------------------------------------------------------------------

  describe('POST /api/webhooks/stripe', () => {
    it('returns 200 and enqueues job for a valid Stripe signature', async () => {
      process.env['STRIPE_WEBHOOK_SECRET'] = STRIPE_SECRET;

      const sig = stripeSig(sampleBody, STRIPE_SECRET);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', sig)
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.provider).toBe('Stripe');
      expect(mockEnqueue).toHaveBeenCalledOnce();
    });

    it('returns 401 for an invalid Stripe signature', async () => {
      process.env['STRIPE_WEBHOOK_SECRET'] = STRIPE_SECRET;

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=9999,v1=badhash')
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
    });

    it('returns 401 for a stale Stripe timestamp', async () => {
      process.env['STRIPE_WEBHOOK_SECRET'] = STRIPE_SECRET;

      // 10 minutes ago
      const staleTs = Math.floor(Date.now() / 1000) - 10 * 60;
      const sig = stripeSig(sampleBody, STRIPE_SECRET, staleTs);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', sig)
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
    });

    it('extracts event type from body.type when no event header is present', async () => {
      const bodyWithType = JSON.stringify({ type: 'payment_intent.succeeded', data: {} });
      const sig = stripeSig(bodyWithType, STRIPE_SECRET);
      process.env['STRIPE_WEBHOOK_SECRET'] = STRIPE_SECRET;

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', sig)
        .send(bodyWithType)
        .expect(200);

      expect(res.body.event).toBe('payment_intent.succeeded');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/gitlab
  // -------------------------------------------------------------------------

  describe('POST /api/webhooks/gitlab', () => {
    it('returns 200 for a valid GitLab token', async () => {
      process.env['GITLAB_WEBHOOK_SECRET'] = GITLAB_SECRET;

      const res = await request(app)
        .post('/api/webhooks/gitlab')
        .set('Content-Type', 'application/json')
        .set('x-gitlab-token', gitlabToken(GITLAB_SECRET))
        .set('x-gitlab-event', 'Push Hook')
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.event).toBe('Push Hook');
    });

    it('returns 401 for a wrong GitLab token', async () => {
      process.env['GITLAB_WEBHOOK_SECRET'] = GITLAB_SECRET;

      const res = await request(app)
        .post('/api/webhooks/gitlab')
        .set('Content-Type', 'application/json')
        .set('x-gitlab-token', 'wrong-token')
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/generic
  // -------------------------------------------------------------------------

  describe('POST /api/webhooks/generic', () => {
    it('returns 200 for a valid generic HMAC signature (sha256= prefix)', async () => {
      process.env['GENERIC_WEBHOOK_SECRET'] = GENERIC_SECRET;

      const sig = genericSig(sampleBody, GENERIC_SECRET);

      const res = await request(app)
        .post('/api/webhooks/generic')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', sig)
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
    });

    it('returns 200 for a valid generic HMAC signature (bare hex, no prefix)', async () => {
      process.env['GENERIC_WEBHOOK_SECRET'] = GENERIC_SECRET;

      const bareHex = crypto.createHmac('sha256', GENERIC_SECRET).update(sampleBody).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/generic')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', bareHex)
        .send(sampleBody)
        .expect(200);

      expect(res.body.received).toBe(true);
    });

    it('returns 401 for an invalid generic HMAC signature', async () => {
      process.env['GENERIC_WEBHOOK_SECRET'] = GENERIC_SECRET;

      const res = await request(app)
        .post('/api/webhooks/generic')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', 'sha256=deadbeef')
        .send(sampleBody)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
    });
  });

  // -------------------------------------------------------------------------
  // Queue error handling
  // -------------------------------------------------------------------------

  describe('Queue error handling', () => {
    it('returns 500 when enqueue throws', async () => {
      mockEnqueue.mockRejectedValueOnce(new Error('Redis connection refused'));

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .send(sampleBody)
        .expect(500);

      expect(res.body.error).toBe('Queue error');
      expect(res.body.message).toContain('Redis connection refused');
    });
  });

  // -------------------------------------------------------------------------
  // PROVIDERS registry (unit tests — no HTTP)
  // -------------------------------------------------------------------------

  describe('PROVIDERS registry', () => {
    it('exports a non-empty provider map', () => {
      expect(Object.keys(PROVIDERS).length).toBeGreaterThanOrEqual(4);
    });

    it('each provider has the required fields', () => {
      for (const [key, cfg] of Object.entries(PROVIDERS)) {
        expect(cfg.name, `${key}.name`).toBeDefined();
        expect(cfg.signatureHeader, `${key}.signatureHeader`).toBeDefined();
        expect(cfg.verify, `${key}.verify`).toBeTypeOf('function');
        expect(cfg.secretEnvKey, `${key}.secretEnvKey`).toBeDefined();
      }
    });
  });
});
