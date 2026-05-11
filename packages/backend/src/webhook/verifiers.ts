/**
 * Webhook Signature Verifiers
 *
 * Each function follows the SignatureVerifier contract:
 *   (rawBody, signature, secret, req) => boolean
 *
 * Important: always use `crypto.timingSafeEqual` for secret comparisons to
 * prevent timing attacks.
 */

import crypto from 'crypto';
import { SignatureVerifier } from './types';

// ---------------------------------------------------------------------------
// GitHub  (X-Hub-Signature-256: sha256=<hmac-sha256-hex>)
// ---------------------------------------------------------------------------

/**
 * Verify a GitHub webhook signature.
 *
 * GitHub signs the raw request body with HMAC-SHA256 using your webhook
 * secret and sends the result as `sha256=<hex>` in the
 * `X-Hub-Signature-256` header.
 */
export const verifyGitHub: SignatureVerifier = (rawBody, signature, secret) => {
  if (!signature.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    // Both buffers must be the same length for timingSafeEqual
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Stripe  (Stripe-Signature: t=<unix>,v1=<hmac-sha256-hex>[,v1=...])
// ---------------------------------------------------------------------------

const STRIPE_TOLERANCE_SECONDS = 5 * 60; // 5 minutes

/**
 * Verify a Stripe webhook signature.
 *
 * Stripe's signed payload is `<timestamp>.<raw_body>`.  The `v1` value(s) in
 * the `Stripe-Signature` header are HMAC-SHA256 hexdigests of that payload.
 * We also enforce a 5-minute timestamp tolerance to prevent replay attacks.
 */
export const verifyStripe: SignatureVerifier = (rawBody, signatureHeader, secret) => {
  // Parse "t=1234,v1=abc,v1=def" → { t: '1234', v1: ['abc', 'def'] }
  const parts: Record<string, string[]> = {};
  for (const chunk of signatureHeader.split(',')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    const key = chunk.slice(0, eq).trim();
    const val = chunk.slice(eq + 1).trim();
    if (!parts[key]) parts[key] = [];
    parts[key].push(val);
  }

  const timestamp = parts['t']?.[0];
  const v1Signatures = parts['v1'] ?? [];

  if (!timestamp || v1Signatures.length === 0) return false;

  // Reject stale webhooks
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > STRIPE_TOLERANCE_SECONDS) {
    return false;
  }

  const signed = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');

  // Accept if any of the v1 signatures match (Stripe sends multiple during
  // secret rotation)
  return v1Signatures.some((sig) => {
    try {
      if (expected.length !== sig.length) return false;
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
};

// ---------------------------------------------------------------------------
// GitLab  (X-Gitlab-Token: <plain-text-secret>)
// ---------------------------------------------------------------------------

/**
 * Verify a GitLab webhook token.
 *
 * GitLab sends the secret as a plain token in `X-Gitlab-Token`.  We use
 * `timingSafeEqual` even here to avoid timing side-channels.
 */
export const verifyGitLab: SignatureVerifier = (_rawBody, signature, secret) => {
  try {
    if (signature.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(secret));
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Generic HMAC-SHA256  (X-Webhook-Signature: sha256=<hex> | <hex>)
// ---------------------------------------------------------------------------

/**
 * Verify a generic HMAC-SHA256 webhook signature.
 *
 * Accepts both `sha256=<hex>` and bare `<hex>` formats.  Useful for
 * custom/internal senders that follow a simple HMAC pattern.
 */
export const verifyHmac: SignatureVerifier = (rawBody, signature, secret) => {
  const PREFIX = 'sha256=';
  const sig = signature.startsWith(PREFIX) ? signature.slice(PREFIX.length) : signature;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    if (expected.length !== sig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
};
