/**
 * Webhook Type Definitions
 */

import { Request } from 'express';

// ---------------------------------------------------------------------------
// Job shape enqueued into BullMQ
// ---------------------------------------------------------------------------

export interface WebhookJobData {
  /** Unique job ID (UUID) */
  id: string;
  /** Human-readable provider name, e.g. "GitHub" */
  provider: string;
  /** Event type extracted from headers / body, e.g. "push" */
  event: string;
  /** Provider-supplied delivery / request ID (for idempotency) */
  deliveryId?: string;
  /** ISO timestamp of when we received the webhook */
  timestamp: string;
  /** Sanitised request headers (no auth tokens) */
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body */
  body: unknown;
}

export interface WebhookJobResult {
  id: string;
  processed: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

/**
 * A signature-verification function.
 *
 * @param rawBody  The raw request body bytes (before any JSON parsing).
 * @param signature The value of the signature header.
 * @param secret    The shared secret / public key for this provider.
 * @param req       The full Express request (for providers that need extra headers).
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export type SignatureVerifier = (
  rawBody: Buffer,
  signature: string,
  secret: string,
  req: Request
) => boolean;

export interface ProviderConfig {
  /** Human-readable name */
  name: string;
  /** Lowercase header name that carries the signature */
  signatureHeader: string;
  /** The verification function for this provider */
  verify: SignatureVerifier;
  /** Name of the environment variable that holds the webhook secret */
  secretEnvKey: string;
}
