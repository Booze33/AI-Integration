# AI Integration Platform API Documentation

## Overview

The AI Integration Platform provides a comprehensive API for managing AI provider configurations, authentication, chat functionality, and file processing in a multi-tenant environment.

## Authentication

All API endpoints require authentication using JWT tokens. The platform uses RS256 asymmetric keys for token signing.

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

**Response:**

```json
{
  "message": "Login successful",
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "role": "admin"
  },
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

### Register

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "role": "member"
}
```

### Refresh Token

```http
POST /auth/refresh
Authorization: Bearer <refresh_token>
```

### Get Current User

```http
GET /auth/me
Authorization: Bearer <access_token>
```

## Tenant AI Configuration

Manage AI provider configurations per tenant with encrypted API keys.

### List Configurations

```http
GET /api/tenant/config
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "config-uuid",
      "tenant_id": "tenant-uuid",
      "provider": "openai",
      "api_key_encrypted": "••••••••••••••••",
      "base_url": "https://api.openai.com",
      "organization": null,
      "default_model": "gpt-4",
      "timeout_ms": 30000,
      "max_retries": 3,
      "is_active": true,
      "metadata": {},
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Create Configuration

```http
POST /api/tenant/config
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "provider": "openai",
  "api_key": "sk-...",
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4",
  "timeout_ms": 30000,
  "max_retries": 3
}
```

**Supported Providers:**

- `openai` - OpenAI API
- `anthropic` - Anthropic Claude
- `deepgram` - Deepgram Speech-to-Text
- `elevenlabs` - ElevenLabs Text-to-Speech
- `azure-openai` - Azure OpenAI
- `google` - Google AI
- `mistral` - Mistral AI
- `groq` - Groq
- `ollama` - Ollama (local)
- `custom` - Custom provider

### Get Configuration

```http
GET /api/tenant/config/{id}
Authorization: Bearer <access_token>
```

### Update Configuration

```http
PUT /api/tenant/config/{id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "base_url": "https://custom-api.example.com",
  "timeout_ms": 60000
}
```

### Delete Configuration

```http
DELETE /api/tenant/config/{id}
Authorization: Bearer <access_token>
```

### List Providers

```http
GET /api/tenant/providers
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "name": "openai",
      "displayName": "OpenAI",
      "requiresApiKey": true
    }
  ]
}
```

## Chat API

Real-time chat with streaming responses and voice transcription.

### Get Chat History

```http
GET /api/chat/history
Authorization: Bearer <access_token>
```

### Transcribe Audio

```http
POST /api/chat/transcribe
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

# Form data with 'audio' file
```

**Response:**

```json
{
  "text": "Hello, how can I help you?",
  "confidence": 0.95
}
```

## Pipeline API

File upload and processing with job tracking.

### Upload File

```http
POST /api/pipeline/upload
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

# Form data with 'file' upload
```

**Response:**

```json
{
  "jobId": "job-uuid",
  "status": "queued",
  "message": "File uploaded successfully"
}
```

### Get Job Status

```http
GET /api/pipeline/jobs/{jobId}
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "jobId": "job-uuid",
  "status": "completed",
  "progress": 100,
  "result": {
    "text": "Extracted text content...",
    "metadata": {}
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message",
  "statusCode": 400
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `500` - Internal Server Error

## Rate Limiting

The API implements multi-scope rate limiting:

- **User Limit**: Per authenticated user
- **Tenant Limit**: Per tenant
- **IP Limit**: Per IP address

Rate limits are configurable via environment variables:

- `RATE_LIMIT_USER_MAX=100` - Requests per window per user
- `RATE_LIMIT_TENANT_MAX=1000` - Requests per window per tenant
- `RATE_LIMIT_IP_MAX=50` - Requests per window per IP
- `RATE_LIMIT_WINDOW_MS=900000` - Window duration (15 minutes)

## Security Features

### API Key Encryption

- All API keys are encrypted using AES-256-CBC
- Unique initialization vectors (IV) per key
- Encryption keys configured via environment variables

### Multi-Tenant Isolation

- Row Level Security (RLS) in PostgreSQL
- Tenant context automatically applied to all queries
- Users can only access resources in their tenant

### Authentication & Authorization

- JWT tokens with RS256 signing
- Refresh token rotation
- Role-based access control (admin, owner, member, viewer)
- Automatic token refresh on expiry

## Environment Variables

### Required

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_PRIVATE_KEY` - RSA private key for JWT signing
- `JWT_PUBLIC_KEY` - RSA public key for JWT verification
- `TENANT_CONFIG_ENCRYPTION_KEY` - AES encryption key for API keys

### Optional

- `PORT=3001` - Server port
- `NODE_ENV=development` - Environment
- `RATE_LIMIT_*` - Rate limiting configuration
- `BACKEND_URL` - Frontend API proxy URL

## Development

### Running Tests

```bash
# Backend tests
cd packages/backend
pnpm test

# Frontend tests
cd packages/frontend
pnpm test
```

### API Client

The frontend includes a typed API client with automatic authentication:

```typescript
import { apiClient } from '@/lib/api-client';

// Login
const response = await apiClient.login({
  email: 'user@example.com',
  password: 'password',
});

// Get tenant configs
const configs = await apiClient.getTenantConfigs();

// Create new config
const newConfig = await apiClient.createTenantConfig({
  provider: 'openai',
  api_key: 'sk-...',
});
```
