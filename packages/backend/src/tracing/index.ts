/**
 * Distributed Tracing - W3C Trace Context Implementation
 *
 * Lightweight distributed tracing with:
 * - W3C Trace Context header support
 * - Span tracking and reporting
 * - Request correlation
 * - Zero external dependencies
 */

import { Request, Response, NextFunction } from 'express';

// ============================================================================
// Tracing Context
// ============================================================================

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

/**
 * Thread-local storage for trace context
 */
const traceContextMap = new Map<string, TraceContext>();
let currentTraceId: string | null = null;

/**
 * Generate trace ID (128-bit lowercase hex)
 */
export function generateTraceId(): string {
  return (
    Math.random().toString(16).substring(2).padEnd(16, '0') +
    Math.random().toString(16).substring(2).padEnd(16, '0')
  );
}

/**
 * Generate span ID (64-bit lowercase hex)
 */
export function generateSpanId(): string {
  return Math.random().toString(16).substring(2).padEnd(16, '0');
}

/**
 * Create trace context
 */
export function createTraceContext(traceId?: string, parentSpanId?: string): TraceContext {
  return {
    traceId: traceId || generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId,
    sampled: Math.random() < 0.1, // 10% sampling rate
  };
}

/**
 * Set current trace context
 */
export function setTraceContext(context: TraceContext) {
  currentTraceId = context.traceId;
  traceContextMap.set(context.traceId, context);
}

/**
 * Get current trace context
 */
export function getTraceContext(): TraceContext | null {
  if (!currentTraceId) return null;
  return traceContextMap.get(currentTraceId) || null;
}

/**
 * Clear trace context
 */
export function clearTraceContext() {
  if (currentTraceId) {
    traceContextMap.delete(currentTraceId);
  }
  currentTraceId = null;
}

// ============================================================================
// W3C Trace Context (https://www.w3.org/TR/trace-context/)
// ============================================================================

/**
 * Encode trace context to W3C header
 */
export function encodeTraceContext(context: TraceContext): string {
  const version = '00';
  const flags = context.sampled ? '01' : '00';
  return `${version}-${context.traceId.padStart(32, '0')}-${context.spanId.padStart(16, '0')}-${flags}`;
}

/**
 * Decode W3C trace context header
 */
export function decodeTraceContext(header: string): TraceContext | null {
  try {
    const parts = header.split('-');

    if (parts.length !== 4) return null;

    return {
      traceId: parts[1],
      spanId: parts[2],
      sampled: parts[3] === '01',
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Span Tracking
// ============================================================================

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: Record<string, any>;
  status: 'unset' | 'ok' | 'error';
  error?: Error;
}

const spans: Span[] = [];

/**
 * Start a span
 */
export function startSpan(name: string, attributes?: Record<string, any>): Span {
  const context = getTraceContext();

  if (!context) {
    const newContext = createTraceContext();
    setTraceContext(newContext);

    return {
      traceId: newContext.traceId,
      spanId: newContext.spanId,
      name,
      startTime: Date.now(),
      attributes: attributes || {},
      status: 'unset',
    };
  }

  const span: Span = {
    traceId: context.traceId,
    spanId: generateSpanId(),
    parentSpanId: context.spanId,
    name,
    startTime: Date.now(),
    attributes: attributes || {},
    status: 'unset',
  };

  return span;
}

/**
 * End a span
 */
export function endSpan(span: Span, status?: 'ok' | 'error', error?: Error) {
  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status || 'ok';
  span.error = error;

  spans.push(span);

  // Log in development
  if (process.env.NODE_ENV === 'development') {
    const duration = span.duration?.toFixed(2) || 'unknown';
    const icon = span.status === 'error' ? '❌' : '✅';
    console.log(`${icon} [${span.traceId.substring(0, 8)}] ${span.name} (${duration}ms)`);
  }

  // Clean up old spans
  if (spans.length > 10000) {
    spans.splice(0, 5000);
  }
}

/**
 * Wrapper for async operations
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const span = startSpan(name, attributes);

  try {
    const result = await fn();
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    endSpan(span, 'error', error as Error);
    throw error;
  }
}

// ============================================================================
// Express Middleware
// ============================================================================

/**
 * Tracing middleware for Express
 */
export function createTracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract trace context from incoming request
    const traceparent = req.get('traceparent');

    let context: TraceContext;

    if (traceparent) {
      const decoded = decodeTraceContext(traceparent);
      if (decoded) {
        context = createTraceContext(decoded.traceId);
      } else {
        context = createTraceContext();
      }
    } else {
      context = createTraceContext();
    }

    // Set context for this request
    setTraceContext(context);

    // Add trace headers to response
    res.set('traceparent', encodeTraceContext(context));

    // Track request span
    const span = startSpan(`${req.method} ${req.path}`, {
      'http.method': req.method,
      'http.url': req.url,
      'http.client_ip': req.ip,
    });

    // Wrap response.end to finish span
    const originalEnd = res.end.bind(res);

    res.end = function (...args: any[]) {
      span.attributes['http.status_code'] = res.statusCode;

      const status = res.statusCode >= 400 ? 'error' : 'ok';
      endSpan(span, status);

      clearTraceContext();

      return (originalEnd as any)(...args);
    };

    next();
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get all collected spans (for debugging)
 */
export function getCollectedSpans(): Span[] {
  return spans;
}

/**
 * Get spans for a trace ID
 */
export function getSpansForTrace(traceId: string): Span[] {
  return spans.filter((s) => s.traceId === traceId);
}

/**
 * Generate trace report
 */
export function generateTraceReport(traceId: string) {
  const traceSpans = getSpansForTrace(traceId);

  if (traceSpans.length === 0) {
    return null;
  }

  const totalDuration = traceSpans.reduce((sum, s) => sum + (s.duration || 0), 0);
  const errors = traceSpans.filter((s) => s.status === 'error');

  return {
    traceId,
    spanCount: traceSpans.length,
    totalDuration,
    errors: errors.length,
    spans: traceSpans.map((s) => ({
      spanId: s.spanId,
      name: s.name,
      duration: s.duration,
      status: s.status,
    })),
  };
}

/**
 * Initialize tracing for service
 */
export function initializeTracing(serviceName: string, version: string) {
  console.log(`📊 Distributed tracing initialized for ${serviceName} v${version}`);
  console.log(`   Format: W3C Trace Context`);
  console.log(`   Sampling: 10%`);

  return {
    generateTraceId,
    generateSpanId,
    getTraceContext,
    setTraceContext,
    startSpan,
    endSpan,
    traceAsync,
  };
}
