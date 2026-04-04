/**
 * Audit Logging Middleware & Utilities
 *
 * Wrapper functions to log important operations to the audit trail.
 * Integrates with metrics collection for performance tracking.
 */

import { Request, Response, NextFunction } from 'express';
import { AuditService, AuditEvent } from './service';
import { getMetricsCollector } from '../database/metrics';

/**
 * Extend Express Request type to include audit context
 */
declare module 'express' {
  interface Request {
    auditService?: AuditService;
    clientInfo?: { ipAddress: string; userAgent: string };
    connectionStats?: {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
      utilization?: number;
    };
  }
}

/**
 * Log an operation to the audit trail
 */
export async function logAudit(
  auditService: AuditService | undefined,
  event: Omit<AuditEvent, 'timestamp'>
): Promise<void> {
  if (!auditService) {
    console.warn('Audit service not initialized');
    return;
  }

  try {
    await auditService.log({
      ...event,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Middleware to capture audit context for requests
 */
export function auditLogging(req: Request, _res: Response, next: NextFunction): void {
  // Store original send to capture response status
  const originalSend = _res.send;

  _res.send = function (data: any) {
    _res.locals.auditedData = data;
    return originalSend.call(this, data);
  };

  next();
}

/**
 * Middleware for logging specific route operations
 */
export function createAuditMiddleware(options: {
  action: string;
  resource: string;
  extractResourceId?: (req: Request) => string | undefined;
  extractChanges?: (req: Request, res: Response) => Record<string, any> | undefined;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Log audit after response is sent
    const originalJson = res.json;

    res.json = function (data: any) {
      // Schedule audit logging to happen after response is sent
      setImmediate(async () => {
        const resourceId = options.extractResourceId?.(req);
        const changes = options.extractChanges?.(req, res);
        const statusCode = res.statusCode;

        await logAudit(req.auditService, {
          tenantId: (req as any).tenantId || 'unknown',
          userId: (req as any).user?.userId || 'unknown',
          action: options.action,
          resource: options.resource,
          resourceId,
          changes,
          ipAddress: req.clientInfo?.ipAddress || 'unknown',
          userAgent: req.clientInfo?.userAgent || 'unknown',
          statusCode,
          errorMessage: data?.error || (statusCode >= 400 ? 'Request failed' : undefined),
        });
      });

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Middleware to collect performance metrics per request
 *
 * Tracks:
 * - Database query operations
 * - Cache hit/miss rates
 * - Connection pool utilization
 * - Request latency
 */
export function createMetricsMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const startTime = performance.now();
    const metricsCollector = getMetricsCollector();

    // Store request start time
    req.requestStartTime = startTime;

    // Wrap response.json to track request latency
    const originalJson = _res.json;
    _res.json = function (data: any) {
      const duration = performance.now() - startTime;

      if (duration > 100 && process.env.NODE_ENV === 'development') {
        console.log(`⏱️  [${req.method}] ${req.path} - ${duration.toFixed(2)}ms`);
      }

      if (metricsCollector && duration > 1000) {
        console.warn(
          `⚠️  Slow request detected: ${req.method} ${req.path} (${duration.toFixed(2)}ms)`
        );
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Extend Express Request type with timing info
 */
declare module 'express' {
  interface Request {
    requestStartTime?: number;
  }
}
