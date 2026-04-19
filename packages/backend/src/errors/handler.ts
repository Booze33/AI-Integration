/**
 * Global Error Handler & 404 Middleware
 *
 * Mount AFTER all routes:
 *
 *   app.use(notFoundHandler);  // catches unmatched routes → 404
 *   app.use(errorHandler);     // catches all thrown / next(err) errors → 4xx/5xx
 *
 * Behaviour:
 *  • Operational errors (AppError subclasses) — send their own statusCode +
 *    message verbatim.
 *  • Programming errors (TypeError, etc.) — send 500 with a generic message;
 *    never leak the real message or stack in production.
 *  • Development / test — includes `stack` and `detail` fields for easier
 *    debugging.
 *  • Correlation ID (`req.requestId`) is always echoed so support teams can
 *    cross-reference client logs with server logs.
 *  • Every error is written to `console.error` regardless of environment.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, isAppError } from './AppError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of every error JSON response body */
export interface ErrorResponse {
  /** Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR") */
  error: string;
  /** Human-readable description — safe to show end users */
  message: string;
  /** Correlation ID from req.requestId — echoed for log cross-referencing */
  correlationId?: string;
  /** HTTP status code (convenience duplicate for clients that only read the body) */
  statusCode: number;
  /** Stack trace — only present in development / test environments */
  stack?: string;
  /** Original error message for programming errors — only in dev/test */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_PRODUCTION = () => process.env.NODE_ENV === 'production';

function isDatabaseAvailabilityError(
  err: Error & { code?: string; errno?: string | number }
): boolean {
  const databaseCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    '57P01',
    '57P03',
    '53300',
  ]);

  if (err.code && databaseCodes.has(err.code)) {
    return true;
  }

  const message = err.message.toLowerCase();
  return [
    'connection terminated unexpectedly',
    'connection request timeout',
    'query timeout',
    'statement timeout',
    'database is unavailable',
    'failed to connect',
    'connect econnrefused',
  ].some((fragment) => message.includes(fragment));
}

/**
 * Normalise any thrown value into a structured response.
 * Handles AppError subclasses, plain Error objects, strings, and
 * anything else that may be thrown.
 */
function normalise(err: unknown): {
  statusCode: number;
  code: string;
  userMessage: string;
  isOperational: boolean;
  originalMessage: string;
  stack: string | undefined;
} {
  if (isAppError(err)) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      userMessage: err.message,
      isOperational: true,
      originalMessage: err.message,
      stack: err.stack,
    };
  }

  // Express / Node errors often carry a `status` or `statusCode` property
  if (err instanceof Error) {
    if (isDatabaseAvailabilityError(err as Error & { code?: string; errno?: string | number })) {
      return {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        userMessage: 'Service temporarily unavailable',
        isOperational: true,
        originalMessage: err.message,
        stack: err.stack,
      };
    }

    const status =
      (err as Error & { status?: number; statusCode?: number }).status ??
      (err as Error & { status?: number; statusCode?: number }).statusCode ??
      500;

    // Treat 4xx errors from third-party middleware as operational
    const isOperational = status >= 400 && status < 500;

    return {
      statusCode: status,
      code: 'INTERNAL_ERROR',
      userMessage: isOperational
        ? err.message
        : 'An unexpected error occurred. Please try again later.',
      isOperational,
      originalMessage: err.message,
      stack: err.stack,
    };
  }

  // Non-Error throw (string, object, etc.)
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    userMessage: 'An unexpected error occurred. Please try again later.',
    isOperational: false,
    originalMessage: String(err),
    stack: undefined,
  };
}

// ---------------------------------------------------------------------------
// 404 handler — must be placed AFTER all real routes
// ---------------------------------------------------------------------------

/**
 * Catch-all for routes that were not matched by any router.
 * Calls `next(err)` so the error handler can format the response consistently.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'NOT_FOUND'));
}

// ---------------------------------------------------------------------------
// Global error handler — must be LAST middleware with exactly 4 parameters
// ---------------------------------------------------------------------------

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const { statusCode, code, userMessage, isOperational, originalMessage, stack } = normalise(err);

  const correlationId = req.requestId; // set by requestLogger middleware

  // Always log the full error server-side
  console.error({
    correlationId,
    error: originalMessage,
    code,
    statusCode,
    isOperational,
    stack,
    method: req.method,
    url: req.originalUrl,
  });

  const body: ErrorResponse = {
    error: code,
    message: userMessage,
    statusCode,
    ...(correlationId ? { correlationId } : {}),
    // Expose stack + detail only outside production
    ...(!IS_PRODUCTION() && stack ? { stack } : {}),
    ...(!IS_PRODUCTION() && !isOperational ? { detail: originalMessage } : {}),
  };

  // If headers have already been sent we can't do anything useful
  if (res.headersSent) {
    return;
  }

  res.status(statusCode).json(body);
}
