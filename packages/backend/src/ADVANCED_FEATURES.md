# Advanced Features Guide

This document covers the advanced features implemented for production-ready operations.

## 1. Distributed Tracing with OpenTelemetry

### Overview

OpenTelemetry integration enables distributed tracing across your microservices, helping you:

- Track requests across service boundaries
- Identify performance bottlenecks
- Debug complex multi-service flows
- Correlate logs with traces

### Setup

```typescript
import { initializeTracing, getTracer, createTracingMiddleware } from '@/tracing';

// Initialize at startup
initializeTracing('ai-integration-backend', '1.0.0');

// Add middleware to Express
app.use(createTracingMiddleware());
```

### Usage

```typescript
const tracer = getTracer('my-service');

// Trace async operations
const span = tracer.startSpan('process-document');
await traceAsync(span, async () => {
  // Your operation here
});

// Trace database queries
import { traceQuery } from '@/tracing';
const querySpan = traceQuery('SELECT * FROM users WHERE id = $1', [userId]);

// Trace cache operations
import { traceCache } from '@/tracing';
const cacheSpan = traceCache('get', 'user:123');

// Trace external API calls
import { traceExternalCall } from '@/tracing';
const apiSpan = traceExternalCall('openai', 'POST', '/chat/completions');
```

### Jaeger Backend

Configure Jaeger for visualization:

```yaml
# docker-compose.yml
jaeger:
  image: jaegertracing/all-in-one:latest
  ports:
    - '16686:16686' # UI
    - '14250:14250' # OTLP receiver
  environment:
    - COLLECTOR_OTLP_ENABLED=true
```

Access the UI at `http://localhost:16686`

## 2. Cursor-Based Pagination

### Overview

Cursor-based pagination is more efficient than offset/limit for large datasets:

- Handles data mutations between requests
- Reduces database query complexity
- Scales better with large offsets
- Backend-agnostic cursor format

### Basic Usage

```typescript
import {
  parseCursorPaginationQuery,
  buildCursorPaginationQuery,
  processCursorPaginationResults,
  applyCursorPaginationHeaders,
} from '@/pagination/cursor';

// In your route handler
router.get('/users', async (req, res) => {
  const options = parseCursorPaginationQuery(req);

  const queryConfig = buildCursorPaginationQuery({
    baseQuery: 'SELECT id, email, created_at FROM users WHERE tenant_id = $1',
    cursorField: 'id',
    cursorOptions: options,
  });

  const result = await client.query(queryConfig.query, [tenantId, ...queryConfig.params]);

  const paginated = processCursorPaginationResults(result.rows, 'id', queryConfig.limit, options);

  applyCursorPaginationHeaders(res, paginated, req.baseUrl);
  res.json(paginated.data);
});
```

### Request/Response

```bash
# Initial request (no cursor)
GET /api/users?limit=20&orderBy=asc

# Response includes next cursor
{
  "data": [...],
  "meta": {
    "hasNextPage": true,
    "hasPreviousPage": false,
    "nextCursor": "eyJpZCI6IjEyMyJ9",
    "previousCursor": null
  }
}

# Next page using cursor
GET /api/users?after=eyJpZCI6IjEyMyJ9&limit=20
```

### Relay GraphQL Format

```typescript
import { toRelayConnection } from '@/pagination/cursor';

const connection = toRelayConnection(paginated, 'id');
// Returns GraphQL-compatible connection format
```

## 3. Load Testing Framework

### Overview

Built-in load testing for performance validation:

- Multiple load patterns (constant, ramp, spike, wave)
- Real-time metrics collection
- Performance bottleneck identification
- No external tools required

### Usage

```typescript
import { LoadTester, LoadTestConfig } from '@/load-testing';

const config: LoadTestConfig = {
  baseURL: 'http://localhost:3001',
  scenarios: [
    {
      name: 'list-users',
      endpoint: '/api/users',
      method: 'GET',
    },
    {
      name: 'create-user',
      endpoint: '/api/users',
      method: 'POST',
      data: { email: 'test@example.com', password: 'secret' },
    },
  ],
  pattern: {
    type: 'ramp', // constant | ramp | spike | wave
    startRPS: 10,
    endRPS: 100,
    durationSeconds: 60,
  },
  warmupRequests: 10,
  concurrency: 20,
};

const tester = new LoadTester(config.baseURL);
const metrics = await tester.runLoadTest(config);

LoadTester.printMetricsReport(metrics, 'Load Test Results');
```

### Metrics Output

```
============================================================
📈 Load Test Results
============================================================

📊 Request Statistics:
   Total Requests:      12345
   Successful:          12000 (97.2%)
   Failed:              345 (2.8%)
   Requests/sec:        205.75

⏱️  Response Time (ms):
   Min:                 10.50
   Avg:                 48.30
   P50:                 45.00
   P95:                 95.00
   P99:                 150.00
   Max:                 500.00

❌ Errors:
   HTTP 500: 200
   Timeout: 145
============================================================
```

## 4. Container Security Hardening

### Overview

Comprehensive security hardening for Docker containers:

- Non-root user execution
- Minimal base image
- Read-only filesystems
- Security headers
- Vulnerability scanning
- Input validation

### Features

#### Non-Root User

Dockerfile runs all processes as non-root user:

```dockerfile
RUN addgroup -g 1000 nodejs && adduser -D -u 1000 nodejs

USER nodejs
```

#### Minimal Image

- Alpine Linux (5MB vs 900MB+ for full images)
- Removed unnecessary tools (npm, apk, etc.)
- No build tools in runtime

#### Security Headers Middleware

```typescript
import { securityHeadersMiddleware } from '@/security';

app.use(securityHeadersMiddleware);
```

Applies:

- Content-Security-Policy
- X-Content-Type-Options
- X-Frame-Options
- Strict-Transport-Security
- X-XSS-Protection

#### Input Validation

```typescript
import { detectSQLInjection, sanitizeInput } from '@/security';

// Detect SQL injection attempts
if (detectSQLInjection(userInput)) {
  throw new Error('Suspicious input detected');
}

// Sanitize user input
const safe = sanitizeInput(userInput);
```

#### Rate Limiting

```typescript
import { RateLimiter, createRateLimitMiddleware } from '@/security';

const limiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  keyGenerator: (req) => req.ip,
});

app.use(
  createRateLimitMiddleware(limiter, {
    windowMs: 60000,
    maxRequests: 100,
  })
);
```

#### Security Checks

```typescript
import { performSecurityChecks, generateSecurityReport } from '@/security';

// Run at startup
const checks = performSecurityChecks();
const report = generateSecurityReport();
console.log(report.recommendations);
```

### Docker Build Security

#### Multi-Stage Build

- Separate build and runtime stages
- Only runtime dependencies in final image
- No source code or tools in production

#### Signed Commits (Optional)

```bash
git commit -S -m "Signed commit"
```

#### Image Scanning

```bash
# Scan with Trivy
trivy image ai-integration:latest

# Scan with Snyk
snyk container test ai-integration:latest
```

### Environment Variables

```env
# Required for security features
NODE_ENV=production
MEMORY_LIMIT_MB=512  # Container memory limit

# Optional security features
JAEGER_ENDPOINT=http://jaeger:14250
CACHE_INVALIDATE_BY_PREFIX=true
```

## Best Practices

### 1. Tracing

- Always use context propagation for multi-service calls
- Tag spans with relevant business context
- Use sampling in high-throughput scenarios

### 2. Pagination

- Always use cursor pagination for large datasets (> 10k rows)
- Include totalCount only when necessary (expensive query)
- Use index on cursor field for optimal performance

### 3. Load Testing

- Run tests in staging environments only
- Start with warm-up phase to stabilize metrics
- Test multiple scenarios (read, write, mixed)
- Capture and analyze failures

### 4. Security

- Regularly run `pnpm audit` to check dependencies
- Update base images monthly
- Enable HTTPS/TLS in production
- Use secrets management (not in code)
- Implement request timeout limits
- Log security events

## Monitoring & Observability

### Metrics

Access diagnostics endpoints:

```bash
# System health
curl http://localhost:3001/api/diagnostics/health

# Jaeger traces
open http://localhost:16686
```

### Alerts (Recommended)

Set up alerts for:

- Error rate > 5%
- P95 response time > 1s
- Rate limit violations
- Security check failures

## Troubleshooting

### Traces Not Appearing

1. Check Jaeger is running: `curl http://localhost:14250`
2. Verify `JAEGER_ENDPOINT` environment variable
3. Check application logs for export errors

### Pagination Cursor Invalid

1. Ensure cursor field is unique and sortable
2. Verify base64 encoding/decoding
3. Check database index on cursor field

### Load Test Failures

1. Check target service is healthy
2. Verify network connectivity
3. Check auth tokens are valid
4. Review application logs for errors

## License

Proprietary - AI Integration
