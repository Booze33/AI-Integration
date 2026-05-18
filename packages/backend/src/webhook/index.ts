/**
 * Webhook Module
 *
 * Public surface of the webhook package.  Import from here; do not import
 * from sub-files directly outside this module.
 *
 * Routes:
 *   POST /api/webhooks/:provider  — verify signature, queue job, return 200
 *   GET  /api/webhooks/health     — service health + supported providers
 *
 * Mount BEFORE express.json() so raw body bytes are available for HMAC
 * verification:
 *
 *   app.use('/api', webhookRoutes);
 *   app.use(express.json());
 */

export { webhookRoutes, PROVIDERS } from './routes';
export { WebhookQueueService, WEBHOOK_QUEUE_NAME } from './queue';
export { WebhookWorkerService, getWebhookWorkerService, closeWebhookWorkerService } from './worker';
export { verifyGitHub, verifyStripe, verifyGitLab, verifyHmac } from './verifiers';
export type { WebhookJobData, WebhookJobResult, ProviderConfig, SignatureVerifier } from './types';
