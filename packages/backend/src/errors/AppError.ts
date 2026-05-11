/**
 * Application Error Classes
 *
 * `AppError` is the base class for every *operational* error — errors that are
 * expected, handled gracefully, and safe to surface to the caller.
 *
 * Operational errors:  NotFoundError, ValidationError, UnauthorizedError, …
 * Programming errors:  TypeError, RangeError, unexpected undefined, …
 *
 * The error handler uses `isOperational` to decide whether to send the
 * original message to the client (operational) or a generic "unexpected error"
 * message (programming).
 */

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  /** HTTP status code to send */
  public readonly statusCode: number;

  /**
   * Machine-readable error code included in the JSON response body.
   * Use SCREAMING_SNAKE_CASE so clients can switch on it.
   */
  public readonly code: string;

  /**
   * `true` for expected operational errors that are safe to surface.
   * `false` (or missing) for unexpected programming errors.
   */
  public readonly isOperational: boolean = true;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    // Preserve the correct stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ---------------------------------------------------------------------------
// Common operational error subclasses
// ---------------------------------------------------------------------------

/** 400 — request payload fails validation */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/** 401 — missing or invalid authentication credentials */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/** 403 — authenticated but insufficient permissions */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** 404 — requested resource does not exist */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/** 409 — state conflict (e.g. duplicate key, optimistic locking) */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/** 422 — well-formed request but semantically unprocessable */
export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(message, 422, 'UNPROCESSABLE_ENTITY');
  }
}

/** 429 — caller has exceeded the rate limit (re-use from rate-limit middleware) */
export class TooManyRequestsError extends AppError {
  constructor(
    message = 'Too many requests',
    public readonly retryAfter?: number
  ) {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

/** 503 — downstream dependency is unavailable */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** Returns `true` when the error is a known operational `AppError`. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError && err.isOperational === true;
}
