/**
 * Request Logger Middleware
 *
 * Assigns a UUID correlation ID to every incoming request and writes two
 * structured JSON log lines — one on arrival, one on completion:
 *
 *   {"phase":"request",  "correlationId":"<uuid>", "method":"GET", "url":"/api/…", …}
 *   {"phase":"response", "correlationId":"<uuid>", "method":"GET", "url":"/api/…",
 *    "status":200, "durationMs":12.34}
 *
 * The correlation ID is:
 *   • taken from the incoming `X-Request-ID` header when present (allows
 *     upstream proxies to inject their own trace IDs), or
 *   • generated as a fresh UUID v4.
 *
 * The ID is:
 *   • attached to `req.requestId` for use by downstream handlers.
 *   • echoed back in the `X-Request-ID` response header so clients can
 *     correlate logs with their own records.
 *
 * Mount as the VERY FIRST middleware so every request — including those that
 * hit the webhook raw-body parser — gets an ID:
 *
 *   app.use(requestLogger());
 *   app.use('/api', webhookRoutes);
 *   app.use(express.json());
 *   …
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { LoggerConfig, LogEntry } from './types';

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

function defaultSerializer(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function defaultWrite(line: string): void {
  process.stdout.write(line + '\n');
}

/** Resolve caller's real IP, honoring common proxy headers. */
function resolveIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const first = Array.isArray(fwd) ? fwd[0] : fwd.split(',')[0];
    return first.trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that logs every request/response pair with a
 * correlation ID.
 *
 * @param config  Optional overrides — skip paths, custom serialiser, custom writer.
 */
export function requestLogger(config: LoggerConfig = {}): RequestHandler {
  const { skip, serializer = defaultSerializer, write = defaultWrite } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    // ------------------------------------------------------------------
    // 1. Resolve / generate correlation ID
    // ------------------------------------------------------------------
    const correlationId =
      (req.headers['x-request-id'] as string | undefined)?.trim() || randomUUID();

    req.requestId = correlationId;
    res.setHeader('X-Request-ID', correlationId);

    // ------------------------------------------------------------------
    // 2. Skip-check (after ID is set so callers still get the header)
    // ------------------------------------------------------------------
    if (skip?.(req)) {
      return next();
    }

    // ------------------------------------------------------------------
    // 3. Log request entry
    // ------------------------------------------------------------------
    const startNs = process.hrtime.bigint();
    const ip = resolveIp(req);

    const requestEntry: LogEntry = {
      phase: 'request',
      correlationId,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      ip,
      userAgent: req.headers['user-agent'],
    };

    write(serializer(requestEntry));

    // ------------------------------------------------------------------
    // 4. Log response exit — use 'finish' event (fires after last byte sent)
    // ------------------------------------------------------------------
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1_000) / 1_000; // µs → ms (3dp)

      // Grab user / tenant context if auth/tenant middleware added them
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub ?? undefined;
      const tenantId = (req as Request & { tenantId?: string }).tenantId ?? undefined;

      const responseEntry: LogEntry = {
        phase: 'response',
        correlationId,
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
        ...(userId ? { userId } : {}),
        ...(tenantId ? { tenantId } : {}),
      };

      write(serializer(responseEntry));
    });

    next();
  };
}
