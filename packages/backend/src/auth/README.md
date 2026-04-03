# JWT Authentication with RS256 (Asymmetric Keys)

This module implements JWT authentication using RSA256 (RS256) asymmetric encryption for secure token signing and verification.

## Features

- **RS256 Asymmetric Signing**: Private key signs, public key verifies
- **Redis-backed Refresh Tokens**: Revocable with automatic TTL expiration
- **Token Rotation**: Old refresh tokens revoked on refresh
- **Multi-device Logout**: Logout from all devices at once
- **Token Management**: View and revoke individual tokens
- **Role-Based Access Control**: Admin, Member, Viewer roles with hierarchy
- **Tenant Context**: Multi-tenant support with tenant_id injected into every request

## Auth Flow - End-to-End

### 1. Registration Flow

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐         ┌───────┐
│ Client  │                    │ Server  │                    │   DB    │         │ Redis │
└────┬────┘                    └────┬────┘                    └────┬────┘         └───┬───┘
     │                              │                              │                   │
     │  POST /auth/register         │                              │                   │
     │  {email, password, role}     │                              │                   │
     │─────────────────────────────>│                              │                   │
     │                              │                              │                   │
     │                              │  Validate input              │                   │
     │                              │  Hash password (bcrypt)      │                   │
     │                              │─────────────────────────────>│                   │
     │                              │                              │                   │
     │                              │  INSERT user                 │                   │
     │                              │<─────────────────────────────│                   │
     │                              │                              │                   │
     │                              │  Generate token pair         │                   │
     │                              │  (RS256 signed JWTs)         │                   │
     │                              │                              │                   │
     │                              │  Store refresh token         │                   │
     │                              │─────────────────────────────────────────────────>│
     │                              │  (TTL: 7 days)               │                   │
     │                              │                              │                   │
     │  201 Created                 │                              │                   │
     │  {user, accessToken,         │                              │                   │
     │   refreshToken}              │                              │                   │
     │<─────────────────────────────│                              │                   │
     │                              │                              │                   │
```

### 2. Login Flow

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐         ┌───────┐
│ Client  │                    │ Server  │                    │   DB    │         │ Redis │
└────┬────┘                    └────┬────┘                    └────┬────┘         └───┬───┘
     │                              │                              │                   │
     │  POST /auth/login            │                              │                   │
     │  {email, password}           │                              │                   │
     │─────────────────────────────>│                              │                   │
     │                              │                              │                   │
     │                              │  Find user by email          │                   │
     │                              │─────────────────────────────>│                   │
     │                              │                              │                   │
     │                              │  Verify password (bcrypt)    │                   │
     │                              │                              │                   │
     │                              │  Generate token pair         │                   │
     │                              │  ┌──────────────────────┐    │                   │
     │                              │  │ Access Token (RS256) │    │                   │
     │                              │  │ - userId             │    │                   │
     │                              │  │ - email              │    │                   │
     │                              │  │ - role               │    │                   │
     │                              │  │ - tenantId           │    │                   │
     │                              │  │ - exp: 15 min        │    │                   │
     │                              │  └──────────────────────┘    │                   │
     │                              │  ┌──────────────────────┐    │                   │
     │                              │  │ Refresh Token (RS256)│    │                   │
     │                              │  │ - same payload       │    │                   │
     │                              │  │ - tokenId (UUID)     │    │                   │
     │                              │  │ - exp: 7 days        │    │                   │
     │                              │  └──────────────────────┘    │                   │
     │                              │                              │                   │
     │                              │  Store refresh token         │                   │
     │                              │─────────────────────────────────────────────────>│
     │                              │  SET refresh_token:{tokenId} │                   │
     │                              │  = userId (TTL: 7d)          │                   │
     │                              │                              │                   │
     │  200 OK                      │                              │                   │
     │  {user, accessToken,         │                              │                   │
     │   refreshToken}              │                              │                   │
     │<─────────────────────────────│                              │                   │
     │                              │                              │                   │
```

### 3. Authenticated Request Flow

```
┌─────────┐                    ┌─────────┐
│ Client  │                    │ Server  │
└────┬────┘                    └────┬────┘
     │                              │
     │  GET /protected-resource     │
     │  Authorization: Bearer <JWT> │
     │─────────────────────────────>│
     │                              │
     │                              │  ┌─────────────────────┐
     │                              │  │ authenticate()      │
     │                              │  │ middleware           │
     │                              │  └──────────┬──────────┘
     │                              │             │
     │                              │  Extract Bearer token
     │                              │             │
     │                              │  Verify JWT (RS256)
     │                              │  - Load public key
     │                              │  - Verify signature
     │                              │  - Check issuer/audience
     │                              │  - Check expiration
     │                              │             │
     │                              │  ┌──────────▼──────────┐
     │                              │  │ requireTenant()     │
     │                              │  │ middleware           │
     │                              │  └──────────┬──────────┘
     │                              │             │
     │                              │  Extract tenantId
     │                              │  from JWT payload
     │                              │             │
     │                              │  Set req.tenantId
     │                              │             │
     │                              │  ┌──────────▼──────────┐
     │                              │  │ requireRole()       │
     │                              │  │ middleware           │
     │                              │  └──────────┬──────────┘
     │                              │             │
     │                              │  Check user.role
     │                              │  against required roles
     │                              │             │
     │                              │  ┌──────────▼──────────┐
     │                              │  │ Controller          │
     │                              │  │ req.user available  │
     │                              │  │ req.tenantId set    │
     │                              │  └─────────────────────┘
     │                              │
     │  200 OK                      │
     │  {data}                      │
     │<─────────────────────────────│
     │                              │
```

### 4. Token Refresh Flow (Rotation)

```
┌─────────┐                    ┌─────────┐                    ┌───────┐
│ Client  │                    │ Server  │                    │ Redis │
└────┬────┘                    └────┬────┘                    └───┬───┘
     │                              │                              │
     │  POST /auth/refresh          │                              │
     │  {refreshToken}              │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  Verify JWT signature        │
     │                              │  (RS256 with public key)     │
     │                              │                              │
     │                              │  Extract tokenId from JWT    │
     │                              │                              │
     │                              │  Check token in Redis        │
     │                              │─────────────────────────────>│
     │                              │  GET refresh_token:{tokenId} │
     │                              │<─────────────────────────────│
     │                              │  (returns userId or null)    │
     │                              │                              │
     │                              │  Verify stored userId        │
     │                              │  matches JWT userId          │
     │                              │                              │
     │                              │  REVOKE old token            │
     │                              │─────────────────────────────>│
     │                              │  DEL refresh_token:{tokenId} │
     │                              │                              │
     │                              │  Generate NEW token pair     │
     │                              │  (new tokenId for refresh)   │
     │                              │                              │
     │                              │  Store NEW refresh token     │
     │                              │─────────────────────────────>│
     │                              │  SET refresh_token:{newId}   │
     │                              │  = userId (TTL: 7d)          │
     │                              │                              │
     │  200 OK                      │                              │
     │  {accessToken,               │                              │
     │   refreshToken}              │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

### 5. Logout Flow

```
┌─────────┐                    ┌─────────┐                    ┌───────┐
│ Client  │                    │ Server  │                    │ Redis │
└────┬────┘                    └────┬────┘                    └───┬───┘
     │                              │                              │
     │  POST /auth/logout           │                              │
     │  {refreshToken}              │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  Extract tokenId from JWT    │
     │                              │                              │
     │                              │  Revoke refresh token        │
     │                              │─────────────────────────────>│
     │                              │  DEL refresh_token:{tokenId} │
     │                              │                              │
     │  200 OK                      │                              │
     │  {message: "Logged out"}     │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
     │  (Client discards tokens)    │                              │
     │                              │                              │
```

### 6. Logout All Devices Flow

```
┌─────────┐                    ┌─────────┐                    ┌───────┐
│ Client  │                    │ Server  │                    │ Redis │
└────┬────┘                    └────┬────┘                    └───┬───┘
     │                              │                              │
     │  POST /auth/logout-all       │                              │
     │  Authorization: Bearer <JWT> │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  Find all user's tokens      │
     │                              │─────────────────────────────>│
     │                              │  KEYS refresh_token:*        │
     │                              │<─────────────────────────────│
     │                              │                              │
     │                              │  For each token:             │
     │                              │  - Check if userId matches   │
     │                              │  - Delete if matches         │
     │                              │─────────────────────────────>│
     │                              │  DEL refresh_token:{id}      │
     │                              │                              │
     │  200 OK                      │                              │
     │  {message: "All devices      │                              │
     │   logged out"}               │                              │
     │<─────────────────────────────│                              │
     │                              │                              │
```

## Token Structure

### Access Token (JWT)

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT"
  },
  "payload": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "admin|member|viewer",
    "tenantId": "tenant-uuid",
    "iss": "ai-initializer",
    "aud": "ai-initializer-client",
    "iat": 1700000000,
    "exp": 1700000900 // 15 minutes
  },
  "signature": "RS256(private_key, header.payload)"
}
```

### Refresh Token (JWT)

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT"
  },
  "payload": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "admin|member|viewer",
    "tenantId": "tenant-uuid",
    "tokenId": "random-uuid", // Unique per token pair
    "iss": "ai-initializer",
    "aud": "ai-initializer-client",
    "iat": 1700000000,
    "exp": 1700604800 // 7 days
  },
  "signature": "RS256(private_key, header.payload)"
}
```

### Redis Storage

```
Key: refresh_token:{tokenId}
Value: userId
TTL: 604800 seconds (7 days)
```

## Overview

- **Private Key**: Used for signing tokens (keep secret!)
- **Public Key**: Used for verifying tokens (can be shared)
- **Redis**: Stores refresh tokens with 7-day TTL for revocability

## Quick Start

### 1. Generate RSA Keypair

```bash
cd packages/backend
pnpm generate-keys
```

This creates:

- `keys/private.pem` - Private key for signing (DO NOT COMMIT)
- `keys/public.pem` - Public key for verification

### 2. Start Redis

Redis is required for refresh token storage. Using Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

Or use the project's docker-compose if available.

### 3. API Endpoints

#### Register User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123",
  "role": "user"  // optional, defaults to "user"
}
```

**Response:**

```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user"
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**

```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user"
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Refresh Token

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJ..."
}
```

**Response:**

```json
{
  "message": "Tokens refreshed successfully",
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Get Current User (Protected)

```http
GET /auth/me
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Logout (Single Device)

```http
POST /auth/logout
Content-Type: application/json

{
  "refreshToken": "eyJ..."
}
```

**Response:**

```json
{
  "message": "Logged out successfully"
}
```

#### Logout All Devices

```http
POST /auth/logout-all
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "message": "Logged out from all devices successfully"
}
```

#### List Active Tokens

```http
GET /auth/tokens
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "activeTokenCount": 2,
  "tokens": ["token-id-1", "token-id-2"]
}
```

#### Revoke Specific Token

```http
DELETE /auth/tokens/:tokenId
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "message": "Token revoked successfully"
}
```

## Tenant Context

### How It Works

Every authenticated request can carry a `tenant_id` that is:

1. Embedded in the JWT token (preferred)
2. Passed via `x-tenant-id` header (fallback)

The tenant context is injected into `req.tenantId` and available in all controllers.

### Middleware

| Middleware                 | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `requireTenant()`          | Requires tenant_id (from JWT or header)          |
| `optionalTenant`           | Attaches tenant_id if available, doesn't require |
| `authenticateWithTenant()` | Combined: authenticate + requireTenant           |

### Usage

```typescript
import { authenticate, requireTenant, authenticateWithTenant, AuthenticatedRequest } from './auth';

// Option 1: Separate middleware
app.get('/projects', authenticate, requireTenant(), (req: AuthenticatedRequest, res) => {
  console.log(req.tenantId); // Available in controller
  console.log(req.user?.tenantId); // Also in JWT payload
  res.json({ projects: [] });
});

// Option 2: Combined middleware
app.get('/data', ...authenticateWithTenant(), (req: AuthenticatedRequest, res) => {
  // Both user and tenantId are available
  res.json({ data: {} });
});

// Optional tenant (doesn't fail if missing)
app.get('/public', optionalTenant, (req: AuthenticatedRequest, res) => {
  if (req.tenantId) {
    // Scoped to tenant
  }
  res.json({ data: {} });
});
```

### Configuration Options

```typescript
requireTenant({
  allowHeader: true, // Allow x-tenant-id header (default: true)
  allowQuery: false, // Allow ?tenant_id= query param (default: false)
});
```

### Database Integration

Use with the existing `TenantDatabase` class for automatic tenant-scoped queries:

```typescript
import { TenantDatabase } from '../database/tenant-context';

app.get('/items', authenticate, requireTenant(), async (req: AuthenticatedRequest, res) => {
  const items = await tenantDb.withTenant(req.tenantId!, async (client) => {
    return client.query('SELECT * FROM items'); // Auto-scoped by RLS
  });
  res.json({ items: items.rows });
});
```

## Usage in Routes

### Protect a Route

```typescript
import { authenticate, AuthenticatedRequest } from './auth';

// Require authentication
app.get('/protected', authenticate, (req: AuthenticatedRequest, res) => {
  console.log(req.user); // { userId, email, role }
  res.json({ message: 'Protected data' });
});
```

### Optional Authentication

```typescript
import { optionalAuth, AuthenticatedRequest } from './auth';

// User attached if token provided, but not required
app.get('/public', optionalAuth, (req: AuthenticatedRequest, res) => {
  if (req.user) {
    res.json({ message: `Hello ${req.user.email}` });
  } else {
    res.json({ message: 'Hello guest' });
  }
});
```

### Role-Based Access Control (RBAC)

#### Role Hierarchy

```
admin (level 3) > member (level 2) > viewer (level 1)
```

#### Using Shorthand Middleware

```typescript
import { authenticate, requireAdmin, requireMember, requireViewer } from './auth';

// Admin only
app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  res.json({ users: [] });
});

// Member or Admin
app.get('/projects', authenticate, requireMember, (req, res) => {
  res.json({ projects: [] });
});

// Any authenticated user (Viewer, Member, or Admin)
app.get('/dashboard', authenticate, requireViewer, (req, res) => {
  res.json({ dashboard: {} });
});
```

#### Using requireMinRole (Hierarchical)

```typescript
import { authenticate, requireMinRole, Role } from './auth';

// Minimum role required - higher roles also have access
app.get('/reports', authenticate, requireMinRole(Role.MEMBER), (req, res) => {
  res.json({ reports: [] });
});
```

#### Using requireRole (Exact Match)

```typescript
import { authenticate, requireRole, Role } from './auth');

// Only specific roles
app.get('/settings', authenticate, requireRole(Role.ADMIN, Role.MEMBER), (req, res) => {
  res.json({ settings: {} });
});
```

#### Conditional Logic in Controllers

```typescript
import { authenticate, hasRole, hasMinRole, Role, AuthenticatedRequest } from './auth';

app.get('/content', authenticate, (req: AuthenticatedRequest, res) => {
  const user = req.user;

  // Check exact role
  if (hasRole(user, Role.ADMIN)) {
    return res.json({ content: 'Admin content' });
  }

  // Check minimum role level
  if (hasMinRole(user, Role.MEMBER)) {
    return res.json({ content: 'Member content' });
  }

  // Viewer content
  res.json({ content: 'Public content' });
});
```

## Token Configuration

| Token Type    | Expiry     | Storage           | Purpose               |
| ------------- | ---------- | ----------------- | --------------------- |
| Access Token  | 15 minutes | Client only       | API authentication    |
| Refresh Token | 7 days     | Redis (revocable) | Get new access tokens |

## How Refresh Tokens Work

1. **Login/Register**: Server generates token pair and stores refresh token in Redis with 7-day TTL
2. **Refresh**: Client sends refresh token, server:
   - Verifies JWT signature
   - Checks token exists in Redis (not revoked)
   - Revokes old token
   - Issues new token pair
   - Stores new refresh token in Redis
3. **Logout**: Server deletes refresh token from Redis
4. **Token expires**: Redis automatically deletes after 7 days (TTL)

## Security Best Practices

1. **Never commit keys** - The `keys/` directory is in `.gitignore`
2. **Use strong passwords** - Minimum 8 characters required
3. **Rotate keys periodically** - Regenerate keypair if compromised
4. **Use HTTPS in production** - Tokens are base64 encoded, not encrypted
5. **Redis security** - Use Redis AUTH and network isolation in production
6. **Token rotation** - Refresh tokens are single-use (rotated on refresh)

## File Structure

```
src/auth/
├── index.ts           # Module exports
├── jwt.ts             # Token generation and verification
├── middleware.ts      # Authentication middleware
├── routes.ts          # Auth endpoints
├── README.md          # This file
└── scripts/
    └── generate-keypair.ts  # Key generation script

src/redis/
└── client.ts          # Redis client and token storage functions
```

## Environment Variables

| Variable    | Default                         | Description          |
| ----------- | ------------------------------- | -------------------- |
| `REDIS_URL` | `redis://:redis@localhost:6379` | Redis connection URL |

For production:

- Store keys in a secrets manager
- Use environment variables for key paths
- Enable Redis AUTH
- Use TLS for Redis connection
