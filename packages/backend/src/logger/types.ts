/**
 * Request Logger Type Definitions
 */

import { Request } from 'express';

// ---------------------------------------------------------------------------
// Augment Express Request with correlationId
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * UUID assigned to this request.  Available to all downstream
       * middleware and route handlers as `req.requestId`.
       */
      requestId: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Log entry shapes
// ---------------------------------------------------------------------------

/** Fields logged when a request arrives */
export interface RequestLogEntry {
  phase: 'request';
  correlationId: string;
  timestamp: string;
  method: string;
  url: string;
  ip: string;
  userAgent?: string;
  /** Populated after auth middleware runs — attach with `optionalAuth` */
  userId?: string;
  /** Populated after tenant middleware runs */
  tenantId?: string;
}

/** Fields logged when a response is sent */
export interface ResponseLogEntry {
  phase: 'response';
  correlationId: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  userId?: string;
  tenantId?: string;
}

export type LogEntry = RequestLogEntry | ResponseLogEntry;

// ---------------------------------------------------------------------------
// Logger configuration
// ---------------------------------------------------------------------------

export interface LoggerConfig {
  /**
   * Return `true` to skip logging for a specific request.
   * Useful for health-check endpoints that would otherwise flood logs.
   *
   * @example
   *   skip: (req) => req.path === '/health'
   */
  skip?: (req: Request) => boolean;

  /**
   * Custom serialiser.  Receives the structured log entry and must return
   * a string.  Defaults to `JSON.stringify(entry)`.
   */
  serializer?: (entry: LogEntry) => string;

  /**
   * Output function.  Defaults to writing a newline-terminated string to
   * `process.stdout`.  Override in tests to capture output.
   */
  write?: (line: string) => void;
}
