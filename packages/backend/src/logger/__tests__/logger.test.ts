/**
 * Request Logger Middleware Tests
 *
 * No external dependencies to mock — the middleware is pure Express plumbing.
 * We capture log output via the `write` config option and inspect it directly.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import { requestLogger } from '../middleware';
import { LogEntry, RequestLogEntry, ResponseLogEntry } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Collect log lines and expose them as parsed objects. */
function createCapture() {
  const lines: LogEntry[] = [];
  const write = (line: string) => lines.push(JSON.parse(line) as LogEntry);
  return { lines, write };
}

function buildApp(cfg: Parameters<typeof requestLogger>[0] = {}) {
  const app = express();
  app.use(requestLogger(cfg));
  app.get('/hello', (_req, res) => res.json({ ok: true }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/error', (_req, res) => res.status(500).json({ error: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requestLogger middleware', () => {
  describe('Correlation ID', () => {
    it('generates a UUID and attaches it to the response header', async () => {
      const app = buildApp({ write: () => {} });
      const res = await request(app).get('/hello').expect(200);

      const id = res.headers['x-request-id'];
      expect(id).toBeDefined();
      // UUID v4 format
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('inherits X-Request-ID from the incoming request header', async () => {
      const app = buildApp({ write: () => {} });
      const res = await request(app)
        .get('/hello')
        .set('x-request-id', 'my-trace-id-123')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('my-trace-id-123');
    });

    it('every request gets a DIFFERENT generated ID', async () => {
      const app = buildApp({ write: () => {} });
      const [r1, r2] = await Promise.all([request(app).get('/hello'), request(app).get('/hello')]);

      expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
    });
  });

  describe('Log output — request phase', () => {
    it('writes a request-phase log line on arrival', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello');

      const entry = lines.find((l) => l.phase === 'request') as RequestLogEntry;
      expect(entry).toBeDefined();
      expect(entry.method).toBe('GET');
      expect(entry.url).toContain('/hello');
      expect(entry.correlationId).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.ip).toBeDefined();
    });

    it('includes user-agent when provided', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello').set('user-agent', 'TestRunner/1.0');

      const entry = lines.find((l) => l.phase === 'request') as RequestLogEntry;
      expect(entry?.userAgent).toBe('TestRunner/1.0');
    });

    it('both log lines share the same correlationId', async () => {
      const { lines, write } = createCapture();
      const res = await request(buildApp({ write })).get('/hello');

      const ids = lines.map((l) => l.correlationId);
      expect(ids.length).toBe(2);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).toBe(res.headers['x-request-id']);
    });
  });

  describe('Log output — response phase', () => {
    it('writes a response-phase log line after the response is sent', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry).toBeDefined();
      expect(entry.status).toBe(200);
      expect(entry.durationMs).toBeTypeOf('number');
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records the correct HTTP status code', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/error');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.status).toBe(500);
    });

    it('durationMs is a positive number', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.durationMs).toBeGreaterThan(0);
    });
  });

  describe('skip option', () => {
    it('does NOT write log lines for skipped paths', async () => {
      const { lines, write } = createCapture();
      const app = buildApp({ write, skip: (req) => req.path === '/health' });
      await request(app).get('/health');

      expect(lines).toHaveLength(0);
    });

    it('still sets X-Request-ID even for skipped paths', async () => {
      const app = buildApp({ write: () => {}, skip: (req) => req.path === '/health' });
      const res = await request(app).get('/health');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('logs requests to non-skipped paths normally', async () => {
      const { lines, write } = createCapture();
      const app = buildApp({ write, skip: (req) => req.path === '/health' });
      await request(app).get('/hello');

      expect(lines).toHaveLength(2); // request + response
    });
  });

  describe('custom serializer', () => {
    it('uses a custom serializer when provided', async () => {
      const rawLines: string[] = [];
      const app = buildApp({
        write: (l) => rawLines.push(l),
        serializer: (entry) => `${entry.phase}|${entry.correlationId}`,
      });

      await request(app).get('/hello');

      expect(rawLines).toHaveLength(2);
      rawLines.forEach((l) => {
        expect(l).toMatch(/^(request|response)\|.+$/);
      });
    });
  });

  describe('user / tenant context', () => {
    it('includes userId in the response log when req.user.userId is set', async () => {
      const { lines, write } = createCapture();
      const app = express();
      app.use(requestLogger({ write }));
      // Simulate auth middleware setting req.user with TokenPayload shape
      app.get('/hello', (req: any, res: Response) => {
        req.user = { userId: 'user-42' };
        res.json({ ok: true });
      });

      await request(app).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.userId).toBe('user-42');
    });

    it('falls back to req.user.sub for legacy payloads', async () => {
      const { lines, write } = createCapture();
      const app = express();
      app.use(requestLogger({ write }));
      app.get('/hello', (req: any, res: Response) => {
        req.user = { sub: 'legacy-user-1' };
        res.json({ ok: true });
      });

      await request(app).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.userId).toBe('legacy-user-1');
    });

    it('includes tenantId in the response log when req.tenantId is set', async () => {
      const { lines, write } = createCapture();
      const app = express();
      app.use(requestLogger({ write }));
      app.get('/hello', (req: any, res: Response) => {
        req.tenantId = 'tenant-99';
        res.json({ ok: true });
      });

      await request(app).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.tenantId).toBe('tenant-99');
    });

    it('includes tenantId in the response log when req.user.tenantId is set', async () => {
      const { lines, write } = createCapture();
      const app = express();
      app.use(requestLogger({ write }));
      app.get('/hello', (req: any, res: Response) => {
        req.user = { userId: 'user-42', tenantId: 'tenant-from-user' };
        res.json({ ok: true });
      });

      await request(app).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.tenantId).toBe('tenant-from-user');
    });

    it('omits userId / tenantId when not set', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello');

      const entry = lines.find((l) => l.phase === 'response') as ResponseLogEntry;
      expect(entry?.userId).toBeUndefined();
      expect(entry?.tenantId).toBeUndefined();
    });
  });

  describe('req.requestId', () => {
    it('is accessible inside route handlers', async () => {
      let capturedId: string | undefined;
      const app = express();
      app.use(requestLogger({ write: () => {} }));
      app.get('/hello', (req: Request, res: Response) => {
        capturedId = req.requestId;
        res.json({ requestId: req.requestId });
      });

      const res = await request(app).get('/hello').expect(200);
      expect(capturedId).toBeDefined();
      expect(capturedId).toBe(res.headers['x-request-id']);
      expect(res.body.requestId).toBe(capturedId);
    });
  });

  describe('IP resolution', () => {
    it('uses x-forwarded-for when present', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello').set('x-forwarded-for', '203.0.113.1');

      const entry = lines.find((l) => l.phase === 'request') as RequestLogEntry;
      expect(entry?.ip).toBe('203.0.113.1');
    });

    it('picks the first IP from an x-forwarded-for chain', async () => {
      const { lines, write } = createCapture();
      await request(buildApp({ write })).get('/hello').set('x-forwarded-for', '10.0.0.1, 10.0.0.2');

      const entry = lines.find((l) => l.phase === 'request') as RequestLogEntry;
      expect(entry?.ip).toBe('10.0.0.1');
    });
  });
});
