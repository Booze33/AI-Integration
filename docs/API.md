# API Reference

Base URL (local): `http://localhost:3001`

Auth methods:

- Bearer token in `Authorization: Bearer <accessToken>`
- HttpOnly cookies (`accessToken`, `refreshToken`) set by auth endpoints

Auth levels used below:

- `Public`: no auth required
- `Authenticated`: valid logged-in user
- `Viewer+`: authenticated with viewer/member/admin
- `Admin/Owner`: authenticated with role `admin` or `owner`

Tenant context rule for protected routes:

- After authentication, tenant context is derived from JWT `tenantId`.
- Caller-controlled tenant inputs (`x-tenant-id`, query `tenant_id`) are not accepted for protected routes.

## Health Endpoints

| Method | Path               | Auth   | Request Body | Response Shape                                                                                                                                      |
| ------ | ------------------ | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`          | Public | none         | `{ status: "ok" }`                                                                                                                                  |
| GET    | `/health/redis`    | Public | none         | success: `{ status: "ok", redis: { ready, singleton, queue } }`; failure: `{ status: "error", redis: ... }`                                         |
| GET    | `/health/db`       | Public | none         | success: `{ status: "ok", database: { connected, name, latency, timestamp } }`; failure: `{ status: "error", database: { connected: false, ... } }` |
| GET    | `/health/detailed` | Public | none         | `{ status, database, pool, server, redis }`                                                                                                         |

## Auth Endpoints (`/auth`)

| Method | Path                    | Auth          | Request Body                                                                                | Response Shape                                                                |
| ------ | ----------------------- | ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/auth/register`        | Public        | `{ email: string, password: string, role?: string, tenantId?: string, tenant_id?: string }` | `{ message, user: { id, email, role, tenantId }, accessToken, refreshToken }` |
| POST   | `/auth/login`           | Public        | `{ email: string, password: string, tenantId?: string, tenant_id?: string }`                | `{ message, user: { id, email, role, tenantId }, accessToken, refreshToken }` |
| POST   | `/auth/refresh`         | Public        | `{ refreshToken?: string }` (or refresh cookie)                                             | `{ message, user: { id, email, role, tenantId }, accessToken, refreshToken }` |
| GET    | `/auth/me`              | Authenticated | none                                                                                        | `{ user: { id, email, role, tenantId, createdAt } }`                          |
| POST   | `/auth/logout`          | Public        | `{ refreshToken?: string }` (optional)                                                      | `{ message: "Logged out successfully" }`                                      |
| POST   | `/auth/logout-all`      | Authenticated | none                                                                                        | `{ message }`                                                                 |
| GET    | `/auth/tokens`          | Authenticated | none                                                                                        | `{ activeTokenCount: number, tokens: string[] }`                              |
| DELETE | `/auth/tokens/:tokenId` | Authenticated | none                                                                                        | `{ message }`                                                                 |

Common auth errors:

- `400` invalid request fields
- `401` invalid/missing credentials
- `403` role or ownership restriction
- `404` user/token not found
- `409` duplicate user (register)

## Chat Endpoints (`/api/chat`)

### HTTP routes

| Method | Path                              | Auth    | Request Body                                                                                                                              | Response Shape                                                                                      |
| ------ | --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/api/chat`                       | Viewer+ | `{ messages: ChatMessage[], model?, temperature?, maxTokens?, topP?, frequencyPenalty?, presencePenalty?, stop?, streamId?, sessionId? }` | `text/event-stream` SSE events: `start`, `chunk`, `done`, `error`                                   |
| POST   | `/api/chat/transcribe/session`    | Viewer+ | none                                                                                                                                      | `{ sessionId: string }`                                                                             |
| GET    | `/api/chat/transcribe/:sessionId` | Viewer+ | none                                                                                                                                      | `text/event-stream` transcription events (`ready`, `transcription`, `transcription-error`, `close`) |
| POST   | `/api/chat/transcribe/:sessionId` | Viewer+ | raw binary audio bytes                                                                                                                    | `{ success: true }`                                                                                 |
| DELETE | `/api/chat/transcribe/:sessionId` | Viewer+ | none                                                                                                                                      | `{ success: true }`                                                                                 |
| GET    | `/api/chat/history`               | Viewer+ | none                                                                                                                                      | `{ sessions: ChatHistorySession[] }`                                                                |
| POST   | `/api/chat/history`               | Viewer+ | `{ messages: ChatMessage[], streamId?: string }`                                                                                          | `{ success: true }`                                                                                 |

Provider capability mismatch contract:

- HTTP status: `501`
- Error code: `PROVIDER_CAPABILITY_UNSUPPORTED`
- Shape: `{ error, code, capability, provider, supportedProviders?, message }`

`ChatMessage` accepted roles: `system`, `user`, `assistant`, `function`.

### WebSocket route

| Protocol | Path       | Auth                                  | Message Payload                                                                                                    | Response                                               |
| -------- | ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| WS       | `/ws/chat` | Bearer token or cookie token required | `{"type":"start","messages": [...],"options"?: {...},"sessionId"?: string}`; `{"type":"abort"}`; `{"type":"ping"}` | JSON events: `start`, `chunk`, `done`, `pong`, `error` |

## Tenant Provider Config Endpoints (`/api/tenant`)

| Method | Path                                 | Auth          | Request Body                                                                                                    | Response Shape                                                                   |
| ------ | ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/tenant/config`                 | Admin/Owner   | none                                                                                                            | `{ success: true, data: TenantConfigMasked[] }`                                  |
| GET    | `/api/tenant/config/:id`             | Admin/Owner   | none                                                                                                            | `{ success: true, data: TenantConfigMasked }`                                    |
| POST   | `/api/tenant/config`                 | Admin/Owner   | `{ provider, api_key, base_url?, organization?, default_model?, default_voice_id?, timeout_ms?, max_retries? }` | `{ success: true, data: TenantConfigMasked }`                                    |
| PUT    | `/api/tenant/config/:id`             | Admin/Owner   | same fields as create, all optional                                                                             | `{ success: true, data: TenantConfigMasked }`                                    |
| DELETE | `/api/tenant/config/:id`             | Admin/Owner   | none                                                                                                            | `{ success: true, message }`                                                     |
| GET    | `/api/tenant/providers`              | Authenticated | none                                                                                                            | `{ success: true, data: [{ name, displayName, requiresApiKey, capabilities }] }` |
| GET    | `/api/tenant/providers/capabilities` | Authenticated | none                                                                                                            | `{ success: true, data: [{ name, capabilities }] }`                              |

`TenantConfigMasked` returns the encrypted key field masked as `api_key_encrypted: "********"`.

`capabilities` shape:

- `chat`
- `chatStream`
- `transcribe`
- `realtimeTranscribe`
- `speak`
- `embed`
- `embedBatch`

## Tenant Usage Cap Endpoints (`/api/tenant/usage-caps`)

| Method | Path                           | Auth        | Request Body                                              | Response Shape                                               |
| ------ | ------------------------------ | ----------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/tenant/usage-caps`       | Admin/Owner | none                                                      | `{ success: true, data: { caps, usage } }`                   |
| PUT    | `/api/tenant/usage-caps`       | Admin/Owner | `{ dailyCapTokens?, monthlyCapTokens?, hardCapEnabled? }` | `{ success: true, data: { caps, usage } }`                   |
| GET    | `/api/tenant/usage-caps/usage` | Admin/Owner | none                                                      | `{ success: true, data: { tenantId, dailyUsedTokens, ... }}` |

## Pipeline Endpoints (`/api/pipeline`)

| Method | Path                         | Auth    | Request Body                                                                          | Response Shape                                                                                                                                   |
| ------ | ---------------------------- | ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/pipeline/upload`       | Viewer+ | multipart form with `file`; query: `chunkSize?`, `chunkOverlap?`, `sentenceBoundary?` | `{ success, file, extraction, chunks, chunkPreviews, chunkTexts }`                                                                               |
| POST   | `/api/pipeline/upload/async` | Viewer+ | multipart form with `file`; query: `chunkSize?`, `chunkOverlap?`                      | `{ success, jobId, status, message }`                                                                                                            |
| GET    | `/api/pipeline/jobs/:jobId`  | Viewer+ | none                                                                                  | `{ success, job: { id, fileId, originalName, status, progress, chunks?, chunkPreviews, chunkTexts, error, createdAt, updatedAt, completedAt } }` |
| GET    | `/api/pipeline/jobs`         | Viewer+ | none (optional query `status`)                                                        | `{ success, jobs: JobSummary[], total }`                                                                                                         |
| GET    | `/api/pipeline/stats`        | Public  | none                                                                                  | `{ success, stats: { waiting, active, completed, failed, delayed } }`                                                                            |
| DELETE | `/api/pipeline/jobs/:jobId`  | Viewer+ | none                                                                                  | `{ success: true, message }`                                                                                                                     |

## Webhook Endpoints (`/api/webhooks`)

| Method | Path                      | Auth                                               | Request Body                                                  | Response Shape                                                   |
| ------ | ------------------------- | -------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| POST   | `/api/webhooks/:provider` | Public (signature-verified when secret configured) | raw payload (`application/json` or provider-specific payload) | `{ received: true, jobId, provider, event }`                     |
| GET    | `/api/webhooks/health`    | Public                                             | none                                                          | `{ status, service: "webhook", providers: string[], timestamp }` |

Supported webhook providers in current implementation:

- `github`
- `stripe`
- `gitlab`
- `generic`

Signature headers:

- GitHub: `x-hub-signature-256`
- Stripe: `stripe-signature`
- GitLab: `x-gitlab-token`
- Generic: `x-webhook-signature`

## Dashboard Endpoints (`/api/dashboard`)

| Method | Path                   | Auth    | Request Body | Response Shape                                                                              |
| ------ | ---------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard/stats` | Viewer+ | none         | `{ success: true, stats: { totalChats, filesUploaded, tokensUsed, apiCalls, queueStats } }` |

## Diagnostics Endpoints (`/api/diagnostics`)

| Method | Path                                             | Auth   | Request Body         | Response Shape                                            |
| ------ | ------------------------------------------------ | ------ | -------------------- | --------------------------------------------------------- |
| GET    | `/api/diagnostics/health`                        | Public | none                 | `{ status, timestamp, checks: { pool, cache, details } }` |
| GET    | `/api/diagnostics/ready`                         | Public | none                 | `{ ready: boolean, status }`                              |
| GET    | `/api/diagnostics/live`                          | Public | none                 | `{ alive: true, timestamp }`                              |
| GET    | `/api/diagnostics/metrics`                       | Public | none                 | metrics snapshot object                                   |
| GET    | `/api/diagnostics/metrics/prometheus`            | Public | none                 | plain text prometheus output                              |
| GET    | `/api/diagnostics/metrics/window?duration=60000` | Public | none                 | `{ window: { durationMs }, metrics }`                     |
| GET    | `/api/diagnostics/metrics/slow-queries?limit=10` | Public | none                 | `{ limit, count, queries }`                               |
| GET    | `/api/diagnostics/pool`                          | Public | none                 | `{ stats, utilization, health }`                          |
| GET    | `/api/diagnostics/cache`                         | Public | none                 | `{ l1, l2Connected, recommendations }`                    |
| POST   | `/api/diagnostics/cache/clear`                   | Public | none                 | `{ message }`                                             |
| POST   | `/api/diagnostics/cache/invalidate-tag`          | Public | `{ tag: string }`    | `{ message, count }`                                      |
| POST   | `/api/diagnostics/cache/invalidate-prefix`       | Public | `{ prefix: string }` | `{ message, count }`                                      |
| GET    | `/api/diagnostics/query-stats`                   | Public | none                 | query optimizer stats object                              |
| GET    | `/api/diagnostics/info`                          | Public | none                 | `{ version, nodeVersion, uptime, memory, environment }`   |
| GET    | `/api/diagnostics/report`                        | Public | none                 | combined diagnostic report object                         |

## Error Response Pattern

Many endpoints return this shape on errors:

```json
{
  "error": "Bad Request | Unauthorized | Forbidden | Not Found | Conflict",
  "message": "Human readable error"
}
```

Validation-heavy endpoints may instead return:

```json
{
  "success": false,
  "errors": [{ "msg": "...", "path": "...", "location": "body" }]
}
```

## cURL Examples

Register:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"StrongPass123!","role":"owner"}'
```

Create tenant provider config:

```bash
curl -X POST http://localhost:3001/api/tenant/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","api_key":"sk-...","default_model":"gpt-4o-mini"}'
```

Webhook test:

```bash
curl -X POST http://localhost:3001/api/webhooks/generic \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: <signature>" \
  -d '{"event":"demo"}'
```
