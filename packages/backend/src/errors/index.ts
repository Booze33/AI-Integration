/**
 * Error Module
 *
 * Typed application errors + global Express error handler.
 *
 * Typical usage in a route handler:
 *
 *   import { NotFoundError, ValidationError } from './errors';
 *
 *   router.get('/:id', async (req, res, next) => {
 *     try {
 *       const item = await db.find(req.params.id);
 *       if (!item) throw new NotFoundError('Item');
 *       res.json(item);
 *     } catch (err) {
 *       next(err);   // ← always forward to errorHandler
 *     }
 *   });
 *
 * Mount in src/index.ts AFTER all routes:
 *
 *   import { notFoundHandler, errorHandler } from './errors';
 *   app.use(notFoundHandler);
 *   app.use(errorHandler);
 */

export {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  TooManyRequestsError,
  ServiceUnavailableError,
  isAppError,
} from './AppError';

export { notFoundHandler, errorHandler } from './handler';
export type { ErrorResponse } from './handler';
