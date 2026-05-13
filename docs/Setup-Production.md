# Production Setup Documentation

This guide is the implementation-level setup and operations reference for this repository.

Use this when you are:

- bootstrapping local development
- preparing a production deployment
- configuring AI providers per tenant
- debugging streaming, queue, auth, or tenancy issues

Related docs:

- API reference: [API.md](API.md)
- user flows: [User-Guide.md](User-Guide.md)
- frontend Vercel-specific steps: [Vercel-Deployment.md](Vercel-Deployment.md)

## 1. Installation Deep Dive

### 1.1 Prerequisites

- Node.js 20+
- pnpm 10+
- Docker Desktop (recommended for local Postgres + Redis)
- OpenSSL (or use the built-in key generation script)

### 1.2 Local Setup (recommended)

1. Clone and install dependencies.

```bash
pnpm install
```

2. Create environment files.

```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env.local
```

PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item packages/backend/.env.example packages/backend/.env
Copy-Item packages/frontend/.env.example packages/frontend/.env.local
```

3. Start local infrastructure.

```bash
docker compose up -d
```

This starts:

- Postgres on `localhost:5433`
- Redis on `localhost:6379`

4. Generate JWT key pair.

```bash
pnpm --filter backend run generate-keys
```

5. Start app services.

```bash
pnpm dev
```

6. Verify health.

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Backend health: http://localhost:3001/health

### 1.3 Docker Setup (dev and self-hosted production base)

#### Local infra-only (fastest dev path)

- Use `docker compose up -d` for Postgres + Redis
- Run backend/frontend with `pnpm dev` on host machine

#### Full containerized app

Backend image is defined in [packages/backend/Dockerfile](../packages/backend/Dockerfile).
Frontend image is defined in [packages/frontend/Dockerfile](../packages/frontend/Dockerfile).

Notes:

- Backend Dockerfile builds TypeScript and starts `packages/backend/dist/src/index.js`
- Frontend Dockerfile currently runs `pnpm --filter frontend dev` (development mode)

For production VPS, prefer a frontend production command (`next build` + `next start`) and keep backend in `NODE_ENV=production`.

### 1.4 Manual Setup (without Docker)

1. Install and run PostgreSQL manually.
2. Install and run Redis manually.
3. Set backend `DATABASE_URL` and `REDIS_URL` in [packages/backend/.env](../packages/backend/.env.example).
4. Generate JWT keys.
5. Start with `pnpm dev`.

Manual setup is useful for managed services in cloud environments where DB/Redis are external.

### 1.5 Troubleshooting Installation

#### Backend fails to start with JWT key errors

Symptoms:

- `Private key not found` or `Public key not found`

Fix:

- run `pnpm --filter backend run generate-keys`
- or set `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` explicitly in env

Reference: [packages/backend/src/auth/jwt.ts](../packages/backend/src/auth/jwt.ts)

#### Redis connection errors

Symptoms:

- queue unavailable
- rate limiting fallback logs

Fix:

- confirm Redis is running on expected URL
- check `REDIS_URL` in backend env
- verify password in Docker compose defaults (`redis`)

Reference: [packages/backend/src/redis/client.ts](../packages/backend/src/redis/client.ts)

#### Frontend can load, but API calls fail

Symptoms:

- auth endpoints 404/failed
- chat page cannot connect

Fix:

- use `NEXT_PUBLIC_API_URL` (not `NEXT_PUBLIC_BACKEND_URL`) in frontend runtime env
- ensure backend CORS includes frontend origin in `CORS_ORIGIN`

Reference: [packages/frontend/src/lib/config.ts](../packages/frontend/src/lib/config.ts)

#### Upload async fails with queue unavailable

Fix:

- ensure Redis is reachable from backend
- check queue health endpoint via `/health/redis`
- confirm backend can create BullMQ connections

Reference: [packages/backend/src/pipeline/queue.ts](../packages/backend/src/pipeline/queue.ts)

## 2. AI Provider Configuration

This project supports provider switching globally and per tenant.

- global provider: env-driven via `ACTIVE_AI_PROVIDER`
- tenant provider: encrypted records in `tenant.ai_configs`

Core references:

- provider module: [packages/backend/src/providers/README.md](../packages/backend/src/providers/README.md)
- factory and switching: [packages/backend/src/providers/factory.ts](../packages/backend/src/providers/factory.ts)
- tenant config repository: [packages/backend/src/providers/postgres-repository.ts](../packages/backend/src/providers/postgres-repository.ts)
- tenant config API routes: [packages/backend/src/providers/routes.ts](../packages/backend/src/providers/routes.ts)

### 2.1 OpenAI

Required:

- API key

Common settings:

- `AI_API_KEY`
- `AI_BASE_URL` (optional)
- `AI_DEFAULT_MODEL`
- `AI_TIMEOUT`
- `AI_MAX_RETRIES`

Streaming quirks:

- SSE chunk delivery from provider is converted to app-level SSE/WebSocket events
- provider retry logic handles rate limiting with retry/backoff behavior

Limits:

- external rate limits from OpenAI
- internal token cap checks before stream starts (tenant usage caps)

Switching:

- set `ACTIVE_AI_PROVIDER=openai` globally
- or create tenant-level config with `provider: openai`

### 2.2 Anthropic

Required:

- Anthropic API key

Streaming quirks:

- content-block style responses are normalized into app chunk stream events
- overloaded/rate-limited responses can be retried based on provider retry policy

Limits:

- Claude model rate limits and context-window constraints

Switching:

- `ACTIVE_AI_PROVIDER=anthropic` or tenant config provider `anthropic`

### 2.3 Deepgram

Required:

- Deepgram API key

Streaming quirks:

- real-time transcription uses provider WebSocket session management
- reconnection attempts are implemented with exponential delay in provider runtime

Limits:

- audio stream throughput and realtime session limits depend on account tier

Switching:

- use as transcription provider globally/tenant-level where needed

Reference: [packages/backend/src/providers/implementations/deepgram.ts](../packages/backend/src/providers/implementations/deepgram.ts)

### 2.4 ElevenLabs

Required:

- ElevenLabs API key

Common settings:

- `default_voice_id`
- model/voice options in provider config

Streaming quirks:

- audio generation calls are network-sensitive; timeout and retry settings matter
- voice settings and output format impact latency and quality

Limits:

- quota and rate limits are account-plan dependent

Switching:

- set provider to `elevenlabs` per tenant for TTS-heavy tenants

### 2.5 Provider Switching Strategy

Recommended production pattern:

1. Keep a global fallback provider in env.
2. Enable per-tenant provider records via `/api/tenant/config`.
3. Store tenant API keys encrypted using `TENANT_CONFIG_ENCRYPTION_KEY`.
4. Roll out provider changes tenant-by-tenant, not globally.

## 3. Deployment Guides

### 3.1 Vercel (frontend)

Use root `packages/frontend` as Vercel project root.

Required env:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_DEFAULT_TENANT_ID`

Backend must:

- allow Vercel domain in `CORS_ORIGIN`
- expose HTTPS API endpoints

Detailed reference: [Vercel-Deployment.md](Vercel-Deployment.md)

### 3.2 Fly.io (backend)

Fly config is in [fly.toml](../fly.toml).

Key points:

- backend container build uses [packages/backend/Dockerfile](../packages/backend/Dockerfile)
- health checks call `/health`
- `force_https` enabled

Production checklist for Fly secrets:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`
- `TENANT_CONFIG_ENCRYPTION_KEY`
- provider keys and webhook secrets

### 3.3 Docker VPS

Recommended architecture:

1. Reverse proxy (Nginx/Caddy) with TLS termination.
2. Backend container (Node + built TS).
3. Frontend container (Next production mode).
4. Managed or self-hosted Postgres and Redis.

Must-have production settings:

- backend `NODE_ENV=production`
- secure CORS allowlist
- HTTPS-only public access
- persistent volumes for DB data (if self-hosted)
- monitoring on `/health`, `/health/db`, `/health/redis`

### 3.4 Railway (optional)

Railway can host backend and managed Postgres/Redis quickly.

Suggested split:

- frontend on Vercel
- backend + DB + Redis on Railway

Checklist:

- set all backend secrets
- verify `CORS_ORIGIN` includes frontend domain
- run smoke tests against `/health` and `/api/chat`

## 4. Multi-Tenancy Architecture

### 4.1 Tenant Isolation

Isolation is enforced at multiple levels:

1. JWT carries `tenantId` in authenticated payload.
2. middleware extracts tenant context into `req.tenantId`.
3. protected routes require tenant middleware (`allowHeader: false`, `allowQuery: false` in core routes).
4. provider configs are queried by `tenant_id`.
5. usage caps and audit logs are recorded per tenant.

Reference: [packages/backend/src/auth/middleware.ts](../packages/backend/src/auth/middleware.ts)

### 4.2 Middleware Flow

Typical protected route flow:

1. `authenticate`
2. role guard (`requireViewer`, `requireMember`, `requireAdmin`)
3. `requireTenant`
4. route logic

Important behavior:

- if JWT has no tenant, caller headers are rejected on strict routes
- prevents tenant spoofing via `x-tenant-id`

### 4.3 Database Structure

Tenant-related structures include:

- `tenant.tenants`
- `tenant.tenant_members`
- `tenant.ai_configs` for encrypted per-tenant provider credentials

Tenant security model in schema docs includes RLS policies based on `app.current_tenant_id`.

Reference: [packages/backend/src/database/schema.sql](../packages/backend/src/database/schema.sql)

## 5. Streaming Architecture

### 5.1 Protocols Used

- HTTP SSE for `/api/chat` and transcription event streams
- WebSocket for `/ws/chat` bidirectional chat events

References:

- SSE chat route: [packages/backend/src/chat/index.ts](../packages/backend/src/chat/index.ts)
- WS route: [packages/backend/src/chat/websocket.ts](../packages/backend/src/chat/websocket.ts)

### 5.2 Buffering and Token Streaming

SSE chat:

- sets `text/event-stream`
- emits `start`, `chunk`, `done`, `error`
- sends heartbeats every 15s
- stores chunks in Redis stream store for short-lived resume

WebSocket chat:

- emits JSON events `start`, `chunk`, `done`, `error`, `pong`
- supports client `abort`

### 5.3 Reconnection Handling

SSE resume behavior:

- client can send `Last-Event-ID` or `streamId`
- server checks Redis stream cache
- replay cached chunks and finalize

Current limitation:

- for in-progress streams, resume is cache replay, not full provider continuation

Reference: [packages/backend/src/redis/stream-store.ts](../packages/backend/src/redis/stream-store.ts)

## 6. Redis + Queues

### 6.1 BullMQ Queues

This project uses BullMQ for background processing with retries.

Pipeline queue (`file-processing`):

- async document extraction/chunking jobs
- retry attempts with exponential backoff
- dead-letter queue for failed jobs

Webhook queue (`webhook-events`):

- enqueue incoming webhook payloads quickly
- verify signatures first, process heavy work asynchronously

References:

- pipeline queue: [packages/backend/src/pipeline/queue.ts](../packages/backend/src/pipeline/queue.ts)
- webhook queue: [packages/backend/src/webhook/queue.ts](../packages/backend/src/webhook/queue.ts)

### 6.2 Background Jobs

Pipeline async path:

1. upload file via `/api/pipeline/upload/async`
2. create queue job
3. worker extracts text and chunks content
4. update in-memory job status map and return progress via polling endpoints

### 6.3 Webhooks

Webhook flow:

1. capture raw bytes using `express.raw`
2. verify provider signature when secret configured
3. enqueue normalized job payload
4. return 200 quickly to avoid provider timeouts

Supported providers:

- GitHub
- Stripe
- GitLab
- Generic HMAC

Reference: [packages/backend/src/webhook/routes.ts](../packages/backend/src/webhook/routes.ts)

### 6.4 Retries

Retries are configured with exponential backoff and bounded attempts:

- pipeline queue attempts: 3
- webhook queue attempts: 3

Operational advice:

- monitor failed and dead-letter queues
- add alerting for sustained queue failures

## 7. Security

### 7.1 JWT Flow

Auth uses RS256 signed JWTs.

- access token: short-lived (default 15m)
- refresh token: longer-lived (default 7d) with token ID stored in Redis

Refresh flow:

1. refresh token verified by signature
2. token ID verified in Redis
3. old token revoked
4. new token pair issued

References:

- JWT implementation: [packages/backend/src/auth/jwt.ts](../packages/backend/src/auth/jwt.ts)
- auth middleware/cookies: [packages/backend/src/auth/middleware.ts](../packages/backend/src/auth/middleware.ts)
- refresh token storage: [packages/backend/src/redis/client.ts](../packages/backend/src/redis/client.ts)

### 7.2 RS256 Keys

Required in production:

- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`

Startup validates key availability before accepting requests.

### 7.3 Rate Limiting

Rate limiting is Redis-backed and layered:

- per-user
- per-tenant
- per-IP (primarily unauthenticated traffic)

Returns:

- standard limit headers
- `429` with `Retry-After`

Reference: [packages/backend/src/rate-limit/middleware.ts](../packages/backend/src/rate-limit/middleware.ts)

### 7.4 Validation and Input Safety

Validation stack:

- environment validation via Zod
- request validation for sensitive routes using `express-validator`
- strict role and tenant checks in middleware

Webhook safety:

- raw-body signature verification before enqueue

## 8. Folder Structure (Real Architecture)

This repo is a pnpm workspace monorepo.

Top-level:

- `packages/backend`: API, auth, streaming, queues, provider integration
- `packages/frontend`: Next.js web app
- `packages/types`: shared types package

Requested conceptual mapping:

- `apps/`: maps to deployable apps in `packages/frontend` and `packages/backend`
- `services/`: domain service modules in backend (`usage-caps`, `audit`, `pipeline`, `database`)
- `providers/`: AI provider abstraction and implementations in `packages/backend/src/providers`
- `middleware/`: auth/rate-limit/logging/security middleware in backend
- `queues/`: queue implementations in `packages/backend/src/pipeline/queue.ts` and `packages/backend/src/webhook/queue.ts`

Key backend areas:

- auth: `packages/backend/src/auth`
- chat streaming + websocket: `packages/backend/src/chat`
- tenant provider config: `packages/backend/src/providers`
- pipeline + background jobs: `packages/backend/src/pipeline`
- webhook intake/verification/queueing: `packages/backend/src/webhook`
- rate limiting: `packages/backend/src/rate-limit`
- redis clients and stream cache: `packages/backend/src/redis`
- database layer and migrations: `packages/backend/src/database`

## 9. Production Readiness Checklist

- set all backend secrets (JWT keys, encryption key, provider keys)
- configure managed Postgres and Redis with backups
- enforce HTTPS and strict CORS
- verify `/health`, `/health/db`, `/health/redis`, and `/api/diagnostics/ready`
- validate queue readiness before enabling async upload at scale
- set tenant usage caps for cost control
- test SSE and WebSocket streaming through your production proxy
- configure webhook secrets before enabling external integrations
