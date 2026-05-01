# AI Integration Boilerplate

A production-oriented monorepo starter for building multi-tenant AI SaaS products.

In 60 seconds: this boilerplate gives you an Express backend (auth, chat streaming, file pipeline, webhooks, diagnostics), a Next.js frontend (auth, dashboard, chat, upload, settings), PostgreSQL + Redis local infrastructure, and pre-wired multi-tenant patterns with role-based access.

## Prerequisites

Install these before running the project:

- Node.js: >= 20.19.0
- pnpm: >= 10
- Docker Engine/Desktop
- Docker Compose (plugin or standalone)
- Git

Why Node >= 20.19.0: the repo uses ESLint 10 packages requiring modern Node runtime support.

## Quick Start (under 10 commands)

From a clean machine to running app:

```bash
git clone <your-repo-url>
cd AI-Integration
pnpm install
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env.local
docker compose up -d
pnpm --filter backend run generate-keys
pnpm dev
```

Windows PowerShell equivalent for env file copies:

```powershell
Copy-Item .env.example .env
Copy-Item packages/backend/.env.example packages/backend/.env
Copy-Item packages/frontend/.env.example packages/frontend/.env.local
```

Open:

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Health: http://localhost:3001/health

Notes:

- Local Docker Postgres is expected on host port 5433 in this repo setup.
- Keep `DATABASE_URL` aligned to the running database port to avoid local auth collisions.

## What This Boilerplate Includes

- Monorepo with backend, frontend, and shared types packages
- JWT auth with access/refresh token flow and session revocation endpoints
- Multi-tenant data model with tenant-scoped records
- AI provider abstraction + per-tenant encrypted provider configs
- Streaming chat over SSE and WebSocket
- File upload + extraction/chunking pipeline (sync + async jobs)
- Webhook ingestion and async queueing
- Redis-based rate limiting and transient runtime stores
- Diagnostics endpoints for health, metrics, cache and pool status

## Monorepo Architecture

### Workspace layout

```text
AI-Integration/
  docs/
  packages/
    backend/   # Express API + workers + DB integrations
    frontend/  # Next.js App Router UI
    types/     # shared TS types package
  docker-compose.yml
  package.json
```

### Backend modules

Primary backend folders in `packages/backend/src`:

- `auth`: registration, login, refresh, profile, session token lifecycle
- `chat`: SSE streaming, transcription session endpoints, chat history, WebSocket chat
- `providers`: provider factory + tenant provider config CRUD
- `pipeline`: upload and extraction/chunking pipeline with async job tracking
- `webhook`: provider webhook verification + queue enqueueing
- `dashboard`: user dashboard stats endpoints
- `database`: DB setup, migrations, diagnostics, metrics, optimizer utilities
- `rate-limit`: Redis-backed limiters
- `redis`: Redis clients and token/stream helpers
- `audit`: env validation, audit helpers, request metadata utilities
- `security`: security headers and hardening middleware
- `errors`, `logger`, `pagination`, `tracing`

### Frontend pages

Current App Router pages in `packages/frontend/src/app`:

- `/` landing page
- `/login` sign in
- `/register` sign up
- `/dashboard` authenticated overview
- `/chat` streaming chat + history + voice transcription UI
- `/chat/upload` chat upload flow
- `/upload` file upload and pipeline jobs
- `/settings` settings shell
- `/settings/ai-providers` tenant AI provider management
- `/settings/active-sessions` refresh token/session management
- `/settings/general` general settings

## Multi-Tenancy Model

Tenant isolation is enforced by data modeling and tenant context propagation.

How it works:

- Users are stored with `tenant_id` and tenant-scoped role assignments.
- Auth flows accept tenant context from:
  - JWT `tenantId`
  - request body `tenantId` or `tenant_id`
  - `x-tenant-id` header (for relevant auth flows)
- After authentication, protected routes require tenant context from JWT `tenantId` only.
  - Caller-controlled `x-tenant-id` and query tenant values are not accepted for protected routes.
- Tenant provider configs are queried and mutated per tenant.
- Database schema includes tenant-scoped entities and policies/helpers for tenant context.

Current tenant onboarding path in this boilerplate:

1. Create tenant record in database (`tenant.tenants`) if you need a net-new tenant.
2. Register user with tenant context (`tenantId` in request body or `x-tenant-id` header).
3. Assign role (owner/admin/member/viewer) as needed.
4. Configure tenant AI provider in `/api/tenant/config`.

Example tenant-aware registration:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-uuid>" \
  -d '{"email":"owner@acme.com","password":"StrongPass123!","role":"owner"}'
```

## Add a New AI Provider

Provider abstraction lives under `packages/backend/src/providers`.

Typical steps:

1. Add provider name/type support in `packages/backend/src/providers/types.ts`.
2. Implement provider class under `packages/backend/src/providers/implementations`.
3. Wire provider selection in `packages/backend/src/providers/factory.ts`.
4. Add any provider-specific config handling in tenant config service/repository if needed.
5. Expose provider in provider list endpoint in `packages/backend/src/providers/routes.ts`.
6. Add tests under `packages/backend/src/providers/__tests__`.

## Add a New Webhook Provider

Webhook verification and provider registry are in `packages/backend/src/webhook`.

Typical steps:

1. Add verifier function (or reuse HMAC helper) in `packages/backend/src/webhook/verifiers.ts`.
2. Add provider entry in `PROVIDERS` map in `packages/backend/src/webhook/routes.ts`:
   - provider name
   - signature header
   - verifier function
   - secret env variable key
3. Add env key to `.env.example` and docs table below.
4. Add tests under `packages/backend/src/webhook/__tests__`.

## Environment Variables

This project validates backend environment at startup.

### Backend environment (`.env`)

| Variable                       | Type                                    | Default                                | Description                                                               |
| ------------------------------ | --------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`                     | enum(`development`,`test`,`production`) | `development`                          | Runtime mode                                                              |
| `PORT`                         | number                                  | `3001`                                 | Backend HTTP port                                                         |
| `HOST`                         | string                                  | `0.0.0.0`                              | Backend bind host                                                         |
| `DATABASE_URL`                 | string (url)                            | none                                   | PostgreSQL connection URL                                                 |
| `REDIS_URL`                    | string (url)                            | none                                   | Redis connection URL                                                      |
| `JWT_PRIVATE_KEY`              | string                                  | none                                   | PEM private key for token signing (optional if using key files)           |
| `JWT_PUBLIC_KEY`               | string                                  | none                                   | PEM public key for token verification (optional if using key files)       |
| `JWT_EXPIRY`                   | string                                  | `15m`                                  | Access token TTL                                                          |
| `JWT_REFRESH_EXPIRY`           | string                                  | `7d`                                   | Refresh token TTL                                                         |
| `TENANT_CONFIG_ENCRYPTION_KEY` | string (32 chars)                       | none                                   | Encryption key for tenant provider secrets                                |
| `RATE_LIMIT_USER_MAX`          | number                                  | `100`                                  | Per-user requests per window                                              |
| `RATE_LIMIT_TENANT_MAX`        | number                                  | `1000`                                 | Per-tenant requests per window                                            |
| `RATE_LIMIT_IP_MAX`            | number                                  | `50`                                   | Per-IP requests per window                                                |
| `RATE_LIMIT_WINDOW_MS`         | number                                  | `900000`                               | Rate limit window in ms                                                   |
| `ENABLE_AUDIT_LOGGING`         | boolean (`true`/`false`)                | `true`                                 | Enable audit logging                                                      |
| `AUDIT_LOG_RETENTION_DAYS`     | number                                  | `90`                                   | Audit retention period                                                    |
| `CORS_ORIGIN`                  | string                                  | `http://localhost:3000`                | Allowed CORS origins (comma-separated supported)                          |
| `CORS_CREDENTIALS`             | boolean (`true`/`false`)                | `true`                                 | Enable CORS credentials                                                   |
| `MAX_FILE_SIZE`                | number                                  | `10485760`                             | Upload max bytes                                                          |
| `ACTIVE_AI_PROVIDER`           | string                                  | `openai`                               | Globally active provider for provider factory                             |
| `AI_API_KEY`                   | string                                  | none                                   | Global API key for active provider (optional for providers like `ollama`) |
| `AI_BASE_URL`                  | string                                  | none                                   | Optional provider base URL override                                       |
| `GITHUB_WEBHOOK_SECRET`        | string                                  | none                                   | GitHub webhook verification secret                                        |
| `STRIPE_WEBHOOK_SECRET`        | string                                  | none                                   | Stripe webhook verification secret                                        |
| `GITLAB_WEBHOOK_SECRET`        | string                                  | none                                   | GitLab webhook verification secret                                        |
| `GENERIC_WEBHOOK_SECRET`       | string                                  | none                                   | Generic HMAC webhook secret                                               |
| `DEFAULT_TENANT_ID`            | uuid string                             | `00000000-0000-0000-0000-000000000000` | Fallback tenant for registration/auth scenarios                           |

### Frontend environment (`packages/frontend/.env.local`)

| Variable                        | Type                     | Default                         | Description                                  |
| ------------------------------- | ------------------------ | ------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | string (url)             | dev fallback in code            | Backend base URL used by frontend API client |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID` | string                   | `default-tenant` (dev fallback) | Default tenant id used by frontend flows     |
| `NEXT_PUBLIC_APP_NAME`          | string                   | `AI Integration`                | Display name                                 |
| `NEXT_PUBLIC_MOCK_MODE`         | boolean (`true`/`false`) | `false`                         | Enable frontend mock mode                    |

## Script Reference (all npm scripts)

### Root scripts (`package.json`)

- `pnpm dev:backend` - run backend dev server only
- `pnpm dev:frontend` - run frontend dev server only
- `pnpm dev` - run backend + frontend together
- `pnpm build` - build backend then frontend
- `pnpm lint` - run eslint fix across repo
- `pnpm format` - format files via prettier
- `pnpm format:check` - check formatting only
- `pnpm prepare` - install husky hooks
- `pnpm docker:up` - docker compose up (detached)
- `pnpm docker:down` - docker compose down
- `pnpm docker:build` - build compose services
- `pnpm docker:logs` - follow compose logs
- `pnpm docker:ps` - list compose service status

### Backend scripts (`packages/backend/package.json`)

- `pnpm --filter backend dev` - start backend with ts-node-dev
- `pnpm --filter backend build` - compile backend TypeScript
- `pnpm --filter backend start` - run compiled backend
- `pnpm --filter backend seed` - run DB seed script
- `pnpm --filter backend migrate` - run node-pg-migrate cli
- `pnpm --filter backend migrate:up` - apply migrations
- `pnpm --filter backend migrate:down` - rollback migration
- `pnpm --filter backend migrate:create -- <name>` - create migration file
- `pnpm --filter backend migrate:status` - migration status
- `pnpm --filter backend generate-keys` - generate JWT keypair
- `pnpm --filter backend test` - run backend tests once
- `pnpm --filter backend test:watch` - run backend tests in watch mode

### Frontend scripts (`packages/frontend/package.json`)

- `pnpm --filter frontend dev` - start next dev server
- `pnpm --filter frontend build` - build frontend
- `pnpm --filter frontend start` - start built frontend
- `pnpm --filter frontend test` - run frontend tests once
- `pnpm --filter frontend test:watch` - run frontend tests in watch mode

### Shared types scripts (`packages/types/package.json`)

- `pnpm --filter @ai-integration/types build` - compile shared types
- `pnpm --filter @ai-integration/types dev` - watch/compile shared types

## API And User Docs

- Full endpoint reference: `docs/API.md`
- End-user guide and walkthroughs: `docs/User-Guide.md`
- Frontend deployment on Vercel: `docs/Vercel-Deployment.md`

## Local Development Tips

- If backend cannot connect to Postgres, verify `DATABASE_URL` points to the running host/port.
- If `pnpm dev` fails quickly, run backend/frontend separately to isolate issues:
  - `pnpm dev:backend`
  - `pnpm dev:frontend`
- If auth keys are missing, regenerate:
  - `pnpm --filter backend run generate-keys`

## License

See `LICENSE`.
