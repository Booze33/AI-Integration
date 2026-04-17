# AI Integration

Single-repo starter for building multi-tenant AI products with:

- Express backend with modular provider adapters (OpenAI, Anthropic, Deepgram, ElevenLabs)
- Next.js frontend with chat, upload, and voice UX flows
- Streaming responses over SSE and WebSocket
- JWT auth (RS256), refresh-token rotation, role guards
- Redis-backed rate limiting and webhook job queueing
- Docker Compose for local Postgres + Redis

This README is the one setup document developers should follow before running the project.

## 1) Prerequisites

Install these first:

- Node.js 20.19.0 (minimum)
- pnpm 10+
- Docker Desktop (or Docker Engine + Compose plugin)
- Git

Why this exact Node floor:

- This repo uses ESLint 10 packages that require Node `^20.19.0` (or newer major lines).
- If your Node version is below 20.19.0, lint/dev scripts can fail even if app code compiles.

Make sure these ports are free:

- `3000` (frontend)
- `3001` (backend)
- `5433` (Postgres from Docker)
- `6379` (Redis from Docker)

Important local DB note:

- Docker Postgres in this repo runs on `5433`, not `5432`.
- If you also run a host Postgres on `5432`, keep `DATABASE_URL` pointed at `5433` to avoid auth conflicts.

## 2) Clone And Install

```bash
git clone <your-repo-url>
cd AI-Integration
pnpm install
```

Use pnpm for workspace dependency changes:

```bash
pnpm --filter backend add <package-name>
pnpm --filter frontend add <package-name>
```

## 3) Start Local Infrastructure

Start only infrastructure services first:

```bash
docker compose up -d postgres redis
docker compose ps
```

Expected endpoints:

- Postgres: `localhost:5433` (`postgres/postgres`, db: `ai_initializer`)
- Redis: `localhost:6379` (password: `redis`)

## 4) Environment Variables

### 4.1 Backend env

Copy the template and set values:

```bash
cp .env.example .env
```

Minimum values you must verify before first run:

```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_initializer
REDIS_URL=redis://:redis@localhost:6379

# exactly 32 chars
TENANT_CONFIG_ENCRYPTION_KEY=replace-with-32-char-key-123456

# provider switch (single-line provider selection)
ACTIVE_AI_PROVIDER=openai
AI_API_KEY=your-provider-key

CORS_ORIGIN=http://localhost:3000
```

Notes:

- Backend validates env on startup and exits fast if required values are missing/invalid.
- Webhook secrets are optional for local dev, but must be set for signature verification:
  - `GITHUB_WEBHOOK_SECRET`
  - `STRIPE_WEBHOOK_SECRET`
  - `GITLAB_WEBHOOK_SECRET`
  - `GENERIC_WEBHOOK_SECRET`

### 4.2 JWT key setup (RS256)

You have two valid options:

- Option A: keep `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` empty in `.env` and generate key files on disk.
- Option B: paste PEM strings into env vars.

Recommended local path (Option A):

```bash
pnpm --filter backend run generate-keys
```

This creates:

- `packages/backend/keys/private.pem`
- `packages/backend/keys/public.pem`

### 4.3 Frontend env

Create `packages/frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_DEFAULT_TENANT_ID=default-tenant
NEXT_PUBLIC_APP_NAME=AI Integration
NEXT_PUBLIC_MOCK_MODE=false
```

`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_DEFAULT_TENANT_ID` are required for production builds.

## 5) Run The App

From repository root:

```bash
pnpm dev
```

What happens:

- Frontend starts on `http://localhost:3000`
- Backend starts on `http://localhost:3001`
- Backend runs DB migrations on startup automatically

Health checks:

- `http://localhost:3001/health`
- `http://localhost:3001/health/db`
- `http://localhost:3001/health/redis`
- `http://localhost:3001/health/detailed`

## 6) First Login And Tenant Bootstrap

There is no default admin user for first run.

Create one via UI:

1. Open `http://localhost:3000/register`
2. Register with email/password (password min length is 8)

Or create one via API:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"StrongPass123!","role":"owner"}'
```

Registration creates tenant context automatically when needed.

## 7) One-Line AI Provider Switching

Swap global provider by editing one env line:

```env
ACTIVE_AI_PROVIDER=anthropic
```

Then provide the matching `AI_API_KEY` and restart backend.

Supported built-in providers:

- `openai`
- `anthropic`
- `deepgram`
- `elevenlabs`

Per-tenant provider configs can also be managed via `/api/tenant/config`.

## 8) Streaming, Uploads, Voice, Webhooks

Key runtime behavior:

- Streaming chat endpoint: `POST /api/chat` (SSE)
- Realtime chat socket: `ws://localhost:3001/ws/chat`
- Upload pipeline: `/api/pipeline/*`
- Webhooks: `POST /api/webhooks/:provider` (queued async via BullMQ)

Webhook local test example:

```bash
curl -X POST http://localhost:3001/api/webhooks/generic \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: <signature>" \
  -d '{"event":"demo"}'
```

If webhook secret env vars are unset, signature verification is skipped in local dev.

## 9) Rate Limiting And Redis

Rate limiting is enabled on `/api` and depends on Redis.

Tune with env vars:

- `RATE_LIMIT_USER_MAX`
- `RATE_LIMIT_TENANT_MAX`
- `RATE_LIMIT_IP_MAX`
- `RATE_LIMIT_WINDOW_MS`

If Redis is unreachable, auth/session/queue features can fail. Always start Redis first.

## 10) Deployment Env Management

### Vercel (frontend)

- Root directory: `packages/frontend`
- Build command: `pnpm build`
- Required envs:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_DEFAULT_TENANT_ID`
  - `NEXT_PUBLIC_MOCK_MODE=false`

See full guide: `docs/Vercel-Deployment.md`.

### Fly.io (backend)

No `fly.toml` is committed in this repo. Generate one for `packages/backend` using `flyctl` and the existing Dockerfile.

Set backend secrets in Fly (minimum):

- `DATABASE_URL`
- `REDIS_URL`
- `TENANT_CONFIG_ENCRYPTION_KEY`
- `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` (or mount keys)
- `ACTIVE_AI_PROVIDER`
- `AI_API_KEY`

## 11) Useful Commands

```bash
# Start/stop local infra
pnpm docker:up
pnpm docker:down

# Logs
pnpm docker:logs

# Build all packages
pnpm build

# Run backend tests
pnpm --filter backend test

# DB seed (optional demo data)
pnpm --filter backend run seed
```

## 12) Complete pnpm Script Reference

This section lists every script currently defined in the workspace and what each one does.

### Root scripts (`/package.json`)

- `pnpm dev:backend`: starts only the backend dev server (`packages/backend`).
- `pnpm dev:frontend`: starts only the frontend dev server (`packages/frontend`).
- `pnpm dev`: starts backend and frontend together via concurrently.
- `pnpm build`: builds backend, then frontend.
- `pnpm lint`: runs ESLint with `--fix` across the repo.
- `pnpm format`: runs Prettier write on TS/JS/JSON/MD files.
- `pnpm format:check`: runs Prettier check (no file writes).
- `pnpm prepare`: installs Husky git hooks.
- `pnpm docker:up`: runs `docker compose up -d`.
- `pnpm docker:down`: runs `docker compose down`.
- `pnpm docker:build`: builds Compose images.
- `pnpm docker:logs`: tails Compose logs.
- `pnpm docker:ps`: lists Compose container status.

### Backend scripts (`packages/backend/package.json`)

- `pnpm --filter backend dev`: runs backend in watch mode with `ts-node-dev`.
- `pnpm --filter backend build`: compiles backend TypeScript to `dist`.
- `pnpm --filter backend start`: runs compiled backend from `dist/index.js`.
- `pnpm --filter backend seed`: seeds the database with demo data.
- `pnpm --filter backend migrate`: runs node-pg-migrate CLI.
- `pnpm --filter backend migrate:up`: applies pending migrations.
- `pnpm --filter backend migrate:down`: rolls back migrations.
- `pnpm --filter backend migrate:create -- <name>`: creates a new migration file.
- `pnpm --filter backend migrate:status`: prints migration status.
- `pnpm --filter backend generate-keys`: generates RS256 key pair in `packages/backend/keys`.
- `pnpm --filter backend test`: runs backend tests once (Vitest).
- `pnpm --filter backend test:watch`: runs backend tests in watch mode.

### Frontend scripts (`packages/frontend/package.json`)

- `pnpm --filter frontend dev`: runs Next.js dev server.
- `pnpm --filter frontend build`: builds Next.js for production.
- `pnpm --filter frontend start`: starts built Next.js app.

### Shared types scripts (`packages/types/package.json`)

- `pnpm --filter @ai-integration/types build`: compiles shared types package.
- `pnpm --filter @ai-integration/types dev`: watches and recompiles shared types.

## 13) Troubleshooting

### Backend exits during startup

- Check `.env` values (backend validates on boot).
- Confirm `TENANT_CONFIG_ENCRYPTION_KEY` is exactly 32 characters.
- Confirm JWT keys exist or env keys are set.

### Postgres auth errors (`28P01`) even though Docker DB is healthy

- Confirm `DATABASE_URL` points to `localhost:5433`, not `5432`.
- Verify docker container is up: `docker compose ps`.

### Frontend cannot reach API

- Confirm `NEXT_PUBLIC_API_URL=http://localhost:3001` in `packages/frontend/.env.local`.
- Confirm backend CORS origin includes `http://localhost:3000`.

### Clean reset

```bash
docker compose down -v
docker compose up -d postgres redis
pnpm dev
```

## 14) Docs

- `docs/API.md`
- `docs/User-Guide.md`
- `docs/Vercel-Deployment.md`
