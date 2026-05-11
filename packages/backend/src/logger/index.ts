/**
 * Request Logger Module
 *
 * Structured JSON request/response logging with UUID correlation IDs.
 *
 * Mount as the VERY FIRST middleware in your Express app:
 *
 *   import { requestLogger } from './logger';
 *   app.use(requestLogger());
 *
 * Every request then carries a `req.requestId` (UUID) and an
 * `X-Request-ID` response header.
 *
 * Skip health-check noise:
 *
 *   app.use(requestLogger({ skip: (req) => req.path === '/health' }));
 */

export { requestLogger } from './middleware';
export type { LogEntry, RequestLogEntry, ResponseLogEntry, LoggerConfig } from './types';
