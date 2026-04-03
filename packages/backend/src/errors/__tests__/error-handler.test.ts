/**
 * Global Error Handler & AppError Tests
 *
 * Tests cover:
 *  - AppError subclass properties (statusCode, code, isOperational)
 *  - isAppError type guard
 *  - notFoundHandler → 404 JSON
 *  - errorHandler with operational AppErrors → correct status + message
 *  - errorHandler with plain programming errors → 500 + generic message
 *  - Stack traces absent in production, present in development
 *  - correlationId echoed from req.requestId
 *  - Non-Error throws (strings, objects)
 *  - Plain Errors with .status / .statusCode properties
 *  - Headers-already-sent guard (no crash)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError,
  isAppError,
} from '../AppError';
import { notFoundHandler, errorHandler } from '../handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal app that throws `err` and has the error handlers mounted. */
function buildApp(err: unknown, requestId = 'test-corr-id') {
  const app = express();
  // Fake the logger attachment
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = requestId;
    next();
  });
  app.get('/test', (_req: Request, _res: Response, next: NextFunction) => {
    next(err);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// AppError class hierarchy
// ---------------------------------------------------------------------------

describe('AppError class hierarchy', () => {
  it('base AppError carries correct defaults', () => {
    const err = new AppError('oops');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('oops');
    expect(err.name).toBe('AppError');
  });

  it('AppError accepts custom statusCode and code', () => {
    const err = new AppError('custom', 418, 'IM_A_TEAPOT');
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('IM_A_TEAPOT');
  });

  it('ValidationError → 400 VALIDATION_ERROR', () => {
    const err = new ValidationError('name is required');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('name is required');
  });

  it('UnauthorizedError → 401 UNAUTHORIZED', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('ForbiddenError → 403 FORBIDDEN', () => {
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new ForbiddenError().code).toBe('FORBIDDEN');
  });

  it('NotFoundError → 404 NOT_FOUND with resource name', () => {
    const err = new NotFoundError('User');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('User not found');
  });

  it('ConflictError → 409 CONFLICT', () => {
    expect(new ConflictError('duplicate').statusCode).toBe(409);
    expect(new ConflictError('duplicate').code).toBe('CONFLICT');
  });

  it('ServiceUnavailableError → 503 SERVICE_UNAVAILABLE', () => {
    expect(new ServiceUnavailableError().statusCode).toBe(503);
  });

  it('has a stack trace', () => {
    const err = new ValidationError('bad');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// isAppError type guard
// ---------------------------------------------------------------------------

describe('isAppError()', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError('x'))).toBe(true);
    expect(isAppError(new NotFoundError())).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(42)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notFoundHandler
// ---------------------------------------------------------------------------

describe('notFoundHandler', () => {
  it('returns 404 JSON for unmatched routes', async () => {
    const app = express();
    app.use((req: Request, _res, next) => {
      req.requestId = 'nf-id';
      next();
    });
    app.use(notFoundHandler);
    app.use(errorHandler);

    const res = await request(app).get('/does-not-exist').expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.statusCode).toBe(404);
    expect(res.body.message).toContain('/does-not-exist');
    expect(res.body.correlationId).toBe('nf-id');
  });

  it('includes method and path in the message', async () => {
    const app = express();
    app.use((req: Request, _r, next) => {
      req.requestId = 'x';
      next();
    });
    app.use(notFoundHandler);
    app.use(errorHandler);

    const res = await request(app).post('/api/missing').expect(404);
    expect(res.body.message).toContain('POST');
    expect(res.body.message).toContain('/api/missing');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — operational AppErrors
// ---------------------------------------------------------------------------

describe('errorHandler — operational AppErrors', () => {
  it('sends the correct status code for ValidationError', async () => {
    const res = await request(buildApp(new ValidationError('email invalid')))
      .get('/test')
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('email invalid');
    expect(res.body.statusCode).toBe(400);
  });

  it('sends 401 for UnauthorizedError', async () => {
    const res = await request(buildApp(new UnauthorizedError())).get('/test').expect(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('sends 404 for NotFoundError', async () => {
    const res = await request(buildApp(new NotFoundError('Order')))
      .get('/test')
      .expect(404);
    expect(res.body.message).toBe('Order not found');
  });

  it('echoes correlationId from req.requestId', async () => {
    const res = await request(buildApp(new ValidationError('x'), 'abc-123'))
      .get('/test')
      .expect(400);

    expect(res.body.correlationId).toBe('abc-123');
  });

  it('responds with Content-Type: application/json', async () => {
    const res = await request(buildApp(new NotFoundError())).get('/test').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ---------------------------------------------------------------------------
// errorHandler — programming / unexpected errors
// ---------------------------------------------------------------------------

describe('errorHandler — programming errors (non-production)', () => {
  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
  });

  it('returns 500 for plain Error', async () => {
    const res = await request(buildApp(new Error('internal secret')))
      .get('/test')
      .expect(500);

    expect(res.body.statusCode).toBe(500);
  });

  it('sends generic message for programming errors in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const res = await request(buildApp(new Error('db credentials leaked')))
      .get('/test')
      .expect(500);

    expect(res.body.message).toBe('An unexpected error occurred. Please try again later.');
  });

  it('includes stack trace in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const res = await request(buildApp(new Error('boom')))
      .get('/test')
      .expect(500);
    expect(res.body.stack).toBeDefined();
  });

  it('includes detail field in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const res = await request(buildApp(new Error('secret detail')))
      .get('/test')
      .expect(500);
    expect(res.body.detail).toBe('secret detail');
  });
});

describe('errorHandler — programming errors (production)', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
  });

  it('does NOT include stack trace in production', async () => {
    const res = await request(buildApp(new Error('boom')))
      .get('/test')
      .expect(500);
    expect(res.body.stack).toBeUndefined();
  });

  it('does NOT include detail field in production', async () => {
    const res = await request(buildApp(new Error('secret')))
      .get('/test')
      .expect(500);
    expect(res.body.detail).toBeUndefined();
  });

  it('sends generic message in production', async () => {
    const res = await request(buildApp(new Error('db password is abc123')))
      .get('/test')
      .expect(500);

    expect(res.body.message).toBe('An unexpected error occurred. Please try again later.');
    expect(res.body.message).not.toContain('abc123');
  });

  it('operational AppError message IS visible in production', async () => {
    const res = await request(buildApp(new ValidationError('email required')))
      .get('/test')
      .expect(400);

    expect(res.body.message).toBe('email required');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — edge cases
// ---------------------------------------------------------------------------

describe('errorHandler — edge cases', () => {
  it('handles a thrown string', async () => {
    const res = await request(buildApp('something went wrong')).get('/test').expect(500);
    expect(res.body.statusCode).toBe(500);
  });

  it('handles a thrown plain object', async () => {
    const res = await request(buildApp({ code: 'WEIRD' }))
      .get('/test')
      .expect(500);
    expect(res.body.statusCode).toBe(500);
  });

  it('handles plain Error with .status = 400 as operational', async () => {
    const err = Object.assign(new Error('bad param'), { status: 400 });
    const res = await request(buildApp(err)).get('/test').expect(400);
    // 4xx errors from third-party middleware show their message
    expect(res.body.message).toBe('bad param');
  });

  it('handles plain Error with .statusCode = 422', async () => {
    const err = Object.assign(new Error('unprocessable'), { statusCode: 422 });
    const res = await request(buildApp(err)).get('/test').expect(422);
    expect(res.body.statusCode).toBe(422);
  });

  it('does not crash when headers are already sent', async () => {
    const app = express();
    app.use((req: Request, _r, next) => {
      req.requestId = 'hdr';
      next();
    });
    app.get('/test', (_req: Request, res: Response, next: NextFunction) => {
      res.status(200).json({ partial: true });
      // Force a second error after headers are sent
      next(new Error('late error'));
    });
    app.use(errorHandler);

    // Should not throw / crash the test
    await request(app).get('/test').expect(200);
  });
});
