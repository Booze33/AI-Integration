# Architecture Consultation Guide

Deep-dive technical documentation covering the system design, decision rationale, and architectural trade-offs in AI Integration Boilerplate. Use this guide when evaluating how this system fits your needs or planning modifications.

## Architecture Overview

### High-Level Design

```
┌─────────────────┐
│   Web Browser   │
│  (React/Next)   │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────────────────────────────────────┐
│          CDN / Load Balancer                     │
│     (SSL termination, geo-routing)              │
└────────┬────────────────────────────────────────┘
         │
         ├─────────────────────────────────────────────┐
         │                                             │
         ▼                                             ▼
   ┌──────────────┐                           ┌──────────────┐
   │   Backend    │◄─────────────────────────►│   Backend    │
   │  Instance 1  │    In-Process             │  Instance 2  │
   │  (Express)   │    Coordination           │  (Express)   │
   └──────┬───────┘                           └──────┬───────┘
          │                                          │
          └──────────────────┬───────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
      ┌────────┐        ┌────────┐        ┌─────────────┐
      │PostgreSQL       │ Redis  │        │ File Storage│
      │ (Primary DB)    │(Cache) │        │    (S3)     │
      └────────┘        └────────┘        └─────────────┘
```

### Key Architectural Principles

1. **Multi-Tenancy by Default**
   - Row-level security (RLS) on all tables
   - Tenant context passed through request lifecycle
   - No cross-tenant data leaks possible at database level

2. **Stateless Backend**
   - All state in PostgreSQL or Redis
   - Easy to scale horizontally
   - Supports blue-green deployments

3. **Encryption in Transit and at Rest**
   - TLS 1.3 for all network communication
   - AES-256 for sensitive database fields
   - Tenant encryption keys managed separately

4. **Event-Driven Where It Matters**
   - WebSocket for real-time chat
   - Webhooks for external integrations
   - Event sourcing for audit trail

5. **Cache-First, Database-Authoritative**
   - Redis for performance
   - PostgreSQL as source of truth
   - Invalidation patterns ensure consistency

---

## Database Architecture

### Schema Design Decisions

#### Multi-Schema Approach

```sql
-- tenant: Multi-tenancy management
tenant.tenants
tenant.tenant_members
tenant.tenant_invitations
tenant.ai_configs          -- Per-tenant AI provider settings
tenant.ai_token_caps       -- Usage limits per tenant

-- auth: Authentication and authorization
auth.users
auth.user_sessions
auth.user_tenants (view)   -- User's accessible tenants

-- app: Application business logic
app.projects
app.project_members
app.tasks
app.comments
app.attachments
app.activity_log
app.tags

-- Usage tracking
app.ai_token_usage_events
app.ai_token_usage_rollups_daily
app.ai_token_usage_rollups_monthly
```

**Why Multi-Schema?**

- Logical separation of concerns
- Easier to understand data relationships
- Better for multi-team organizations
- Simplifies migrations and versioning

### Row-Level Security (RLS) Strategy

Every table has an RLS policy:

```sql
-- Example policy
CREATE POLICY tenant_isolation ON app.tasks
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Benefits:**

- Impossible to accidentally leak data across tenants
- Database-level enforcement (not application-level)
- Works even if code has bugs
- Supports multiple tenants per user

**Trade-Off:**

- Small performance overhead (~2-5%)
- Requires setting session context for every query
- Cannot use certain performance optimization tricks

### Indexing Strategy

```sql
-- Tenant-scoped queries (most common)
CREATE INDEX idx_tasks_tenant_id ON app.tasks(tenant_id);
CREATE INDEX idx_tasks_tenant_status ON app.tasks(tenant_id, status);

-- User queries
CREATE INDEX idx_users_email ON auth.users(email);  -- Login lookups

-- Temporal queries
CREATE INDEX idx_tasks_created_at ON app.tasks(created_at DESC);
CREATE INDEX idx_audit_logs_timestamp ON app.audit_logs(timestamp DESC);

-- Composite queries
CREATE INDEX idx_tasks_tenant_assignee ON app.tasks(tenant_id, assignee_id);
```

**Indexing Trade-Offs:**

- More indexes = faster reads, slower writes
- Indexes consume disk space and memory
- During scaling, may need to add/remove indexes

### Partitioning Strategy

For tables growing beyond 100M rows:

```sql
-- Partition by time (automatic for time-series data)
CREATE TABLE app.ai_token_usage_events_2024_q1 PARTITION OF app.ai_token_usage_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

-- Partition by tenant (for massive multi-tenant systems)
CREATE TABLE app.tasks_tenant_a PARTITION OF app.tasks
    FOR VALUES IN ('tenant-uuid-a', 'tenant-uuid-b');
```

**When to Partition:**

- Single table > 100M rows
- Time-series data with archival needs
- Massive tenant count (1000+)

**Benefits:**

- Faster queries on specific partitions
- Easier archival (drop old partitions)
- Parallel query execution

---

## Backend Architecture

### Request Lifecycle

```
1. Request arrives at load balancer
   │
2. TLS termination
   │
3. Express middleware chain:
   ├─ Request logging
   ├─ CORS handling
   ├─ Authentication (JWT validation)
   ├─ Tenant context setting
   ├─ Rate limiting
   ├─ Request validation
   │
4. Route handler
   ├─ Business logic
   ├─ Database queries (with RLS active)
   ├─ Cache operations
   │
5. Response formatting
   ├─ Audit logging (if mutation)
   ├─ Serialization
   ├─ Compression
   │
6. Send response
```

### Authentication & Authorization

#### JWT Strategy

```
Header: {
  "alg": "RS256",
  "typ": "JWT"
}

Payload: {
  "sub": "user-uuid",
  "email": "user@example.com",
  "tenant_id": "tenant-uuid",
  "role": "admin",  // Could be user/admin
  "iat": 1234567890,
  "exp": 1234571490  // 1 hour
}
```

**Why RS256 (RSA)?**

- Public key can be distributed to frontend for verification
- More secure than HS256 (shared secret)
- Standard for OAuth flows

**Session Management:**

- JWT access token: 15 minutes (short-lived)
- Refresh token: 7 days (long-lived, httpOnly cookie)
- Session record in database for revocation

**Advantages:**

- Stateless (no session lookup per request)
- Works well with microservices
- Can verify offline at edge

**Disadvantages:**

- Can't instantly revoke without database check
- Needs secure key rotation strategy

#### Role-Based Access Control (RBAC)

```
User roles:
├─ admin: Full access to tenant
├─ member: Can view/edit projects and tasks
└─ viewer: Read-only access

Resource-level permissions:
├─ Projects: owner (creator), can invite members
├─ Tasks: assigned user, project members
└─ Chat: tenant members only
```

**Implementation:**

- Roles stored in database
- Checked at API route level
- Enforced by RLS at database level

### Cache Strategy

#### Three-Tier Caching

```
L1: In-Process Memory (per instance)
    ├─ User preferences: 5-minute TTL
    ├─ Tenant settings: 15-minute TTL
    └─ Size: ~50MB per instance

L2: Redis (shared across instances)
    ├─ Session data: 7-day TTL
    ├─ Query result cache: 1-hour TTL
    ├─ Rate limit counters: 15-minute TTL
    └─ Size: 1-10GB (depends on stage)

L3: Database (source of truth)
    ├─ Always consulted for writes
    ├─ Cache miss triggers read
    └─ Used for audit trail
```

#### Cache Invalidation Patterns

1. **Time-Based (Simple, Predictable)**

   ```typescript
   // Cache expires after 1 hour
   cache.set('user:123:settings', settings, { ttl: 3600 });
   ```

2. **Event-Based (Accurate, Complex)**

   ```typescript
   // When user updates settings
   await updateSettings(userId, newSettings);
   await cache.invalidate(`user:${userId}:settings`);
   ```

3. **Conditional (Balance)**
   ```typescript
   // Cache with version number
   const version = await getSettingsVersion(userId);
   const cached = cache.get(`user:${userId}:settings:v${version}`);
   ```

**Trade-Offs:**

- Time-based: Simple but may serve stale data
- Event-based: Accurate but complex coordination
- Conditional: Best of both, but harder to debug

### WebSocket Architecture for Chat

```
Client connects
     │
     ▼
Upgrade to WebSocket
     │
     ├─ Authenticate JWT
     ├─ Set tenant context
     └─ Add to Redis channel
     │
     ▼
Client sends message
     │
     ├─ Validate message
     ├─ Store in database (audit trail)
     ├─ Publish to Redis channel
     └─ Broadcast to subscribers
     │
     ▼
Other clients receive
     │
     └─ Connected to same channel
```

**Why Redis Pub/Sub?**

- Messages distributed across backend instances
- Scalable to 1000s of concurrent connections
- Built-in pattern matching for subscriptions

**Limitations:**

- Messages not persisted (need database for history)
- Pub/Sub semantics (no durability guarantees)

**For Production:**

- Consider Redis Streams or Kafka for durability

---

## Frontend Architecture

### State Management

```
┌─────────────────────────────────────────┐
│          Next.js App Router             │
├─────────────────────────────────────────┤
│                                         │
│  ┌─ User Page                           │
│  │  ├─ React Query (server state)       │
│  │  ├─ Zustand (UI state)               │
│  │  └─ Suspense (loading states)        │
│  │                                      │
│  ├─ Settings Page                       │
│  │  └─ Form state (React Hook Form)     │
│  │                                      │
│  ├─ Chat Page                           │
│  │  ├─ WebSocket connection             │
│  │  ├─ Message history (React Query)    │
│  │  └─ Real-time updates (Zustand)      │
│  │                                      │
│  └─ Admin Dashboard                     │
│     └─ Cached queries (1-hour TTL)      │
│                                         │
└─────────────────────────────────────────┘
        │
        ▼
    ┌────────────────┐
    │  Browser Cache │
    │  (IndexedDB)   │
    └────────────────┘
```

**Why Multiple State Management?**

- React Query: Server state (from API)
- Zustand: Local UI state (form inputs, modals)
- Browser cache: Offline support

### Performance Optimizations

1. **Code Splitting**

   ```typescript
   const AdminDashboard = dynamic(
     () => import('./AdminDashboard'),
     { ssr: false, loading: () => <Skeleton /> }
   );
   ```

   - Only load if user has admin role
   - Reduces initial bundle by 200KB

2. **Image Optimization**
   - Next.js Image component: automatic WebP, lazy loading
   - Avatar images: optimized to 50x50px
   - Document thumbnails: cached at CDN

3. **Route Prefetching**
   - Prefetch next likely route on hover
   - Reduces perceived latency

---

## Security Architecture

### Data Classification

```
Public (No encryption)
├─ Tenant name
├─ Public user profiles
└─ Aggregate statistics

Internal (In-transit encryption)
├─ User email addresses
├─ Chat messages (user-to-user)
└─ File names

Confidential (Encrypted at rest + in-transit)
├─ AI API keys (encrypted with AES-256)
├─ Password hashes (bcrypt with salt)
├─ Session tokens (in Redis with TTL)
└─ PII (user's first/last name)

Restricted (Maximum protection)
├─ Encryption keys themselves (Vault)
├─ Admin audit logs
└─ Payment information (external PCI-compliant service)
```

### Key Rotation Strategy

```
Timeline:
├─ Year 1: Key A (active)
├─ Year 2: Key B (active) + Key A (decrypt-only)
├─ Year 3: Key C (active) + Key B (decrypt-only)
└─ Year 4: Key D (active) + Key C (decrypt-only)
    + Forget Key A (outside 3-year rotation window)

Data re-encryption:
├─ On access: Decrypt with old key, re-encrypt with new
├─ Batch: Background job to find missed fields
└─ Schedule: Annual full re-encryption audit
```

### Rate Limiting Strategy

```
Three-tier approach:

Tier 1: IP-based
├─ Limit: 50 requests / 15 minutes per IP
├─ Purpose: Prevent brute force attacks
└─ Bypassed: Logged-in users

Tier 2: User-based
├─ Limit: 100 requests / 15 minutes per user
├─ Purpose: Prevent resource abuse
└─ Tracked: In Redis (scales to millions)

Tier 3: Tenant-based
├─ Limit: 1,000 requests / 15 minutes per tenant
├─ Purpose: Fair resource sharing
└─ Upgrade: Adjust limit with subscription tier

Specific endpoint limits:
├─ /auth/register: 5 per hour per IP (account spam)
├─ /chat/send: 60 per hour per user (spam prevention)
├─ /files/upload: 10 files per hour per tenant
└─ /ai/*: 100 tokens per minute per tenant (usage cap)
```

---

## Deployment Architecture

### Environment Promotion

```
Development (local)
    │
    ├─ Tests pass
    ├─ Code reviewed
    │
    ▼
Staging (production-like)
    │
    ├─ Integration tests
    ├─ Load testing
    ├─ Security scan
    ├─ 24-hour soak test
    │
    ▼
Production (live)
    │
    ├─ Blue-green deployment
    ├─ 1% canary traffic
    ├─ Monitor error rate
    ├─ If good: 100% traffic shift
    ├─ If bad: Rollback (< 2 min)
    │
    ▼
Monitoring (24/7)
```

### Infrastructure as Code

```yaml
# Example: Kubernetes manifest structure
├─ namespaces/
│  ├─ default
│  ├─ monitoring
│  └─ logging
├─ backend/
│  ├─ deployment.yaml (3 replicas)
│  ├─ service.yaml (LoadBalancer)
│  ├─ hpa.yaml (auto-scaling rules)
│  └─ pdb.yaml (pod disruption budget)
├─ database/
│  ├─ statefulset.yaml (PostgreSQL)
│  └─ pvc.yaml (persistent volume)
└─ ingress/
├─ tls-certificate.yaml
└─ routing-rules.yaml
```

**Benefits:**

- Version controlled
- Reproducible environments
- Easy to audit changes
- Enables GitOps workflows

---

## Architectural Decision Records (ADRs)

### ADR-1: Multi-Schema PostgreSQL vs. Multi-Database

**Decision:** Multi-schema within single database

**Reasoning:**

- Simpler transactions across schemas
- Easier to backup/restore
- Costs less (one database instance)
- Still provides logical separation

**Rejected Alternative:** Separate database per tenant

- Pros: Extreme isolation
- Cons: Complex cross-tenant queries, higher costs

---

### ADR-2: JWT vs. Session Cookies

**Decision:** JWT + Refresh tokens

**Reasoning:**

- Stateless (easy to scale)
- Works with GraphQL (no sessions concept)
- Better for mobile apps
- Standard for OAuth flows

**Trade-Off:**

- Must implement token revocation (database check)
- Key rotation more complex

---

### ADR-3: Synchronous API vs. Event-Driven

**Decision:** Synchronous by default, events for specific operations

**Reasoning:**

- Simpler to debug and test
- Consistent error handling
- Meets 99% of use cases

**Events Used For:**

- Audit logging (eventual consistency ok)
- Notifications (email, in-app)
- Analytics (can be delayed)
- WebSocket broadcasts (multi-instance delivery)

---

### ADR-4: Row-Level Security vs. Application-Level Checks

**Decision:** RLS as enforcement, application checks for UX

**Reasoning:**

- RLS prevents data leaks even if code has bugs
- Application checks provide early error feedback
- Defense in depth strategy
- Small performance cost justified

---

## Integration Points

### Third-Party API Integration Pattern

```typescript
// Generic pattern for integrating external services
interface ProviderAdapter {
  configure(apiKey: string): Promise<void>;
  invoke(request: AIRequest): Promise<AIResponse>;
  validateCredentials(): Promise<boolean>;
}

// Usage
const provider = new OpenAIAdapter();
await provider.configure(tenantConfig.apiKey);
const response = await provider.invoke(userMessage);
```

**Providers Supported:**

- OpenAI (default)
- Anthropic
- Google Cloud AI
- Azure OpenAI
- Self-hosted (Ollama)
- Custom (implement adapter)

**Error Handling:**

- Retry failed requests with exponential backoff
- Track usage for billing
- Log all interactions for audit trail

---

## Limitations & Trade-Offs

### Known Limitations

1. **Monolithic Backend**
   - Everything in one codebase
   - Harder to scale independent services
   - **Fix at scale:** Extract microservices

2. **Synchronous API**
   - No built-in long-polling support
   - Large file uploads block connection
   - **Fix:** Add job queue for heavy work

3. **Single PostgreSQL Instance (Stage 1-2)**
   - Single point of failure
   - Fixed throughput ceiling
   - **Fix at scale:** Add read replicas, sharding

4. **Redis Pub/Sub for WebSockets**
   - Messages not persisted
   - No ordering guarantees across crashes
   - **Fix:** Migrate to Redis Streams

### When to Reconsider This Architecture

- **Users > 1M**: Consider sharding/microservices
- **Data > 1TB**: May need data warehouse separation
- **Latency critical (< 100ms)**: May need edge computing
- **Custom compliance**: May need dedicated infrastructure

---

## Glossary

| Term           | Definition                                               |
| -------------- | -------------------------------------------------------- |
| **RLS**        | Row-Level Security - Database-enforced data isolation    |
| **JWT**        | JSON Web Token - Stateless authentication token          |
| **TTL**        | Time To Live - When cache/token expires                  |
| **RTO**        | Recovery Time Objective - Target time to restore service |
| **RPO**        | Recovery Point Objective - Maximum acceptable data loss  |
| **SLA**        | Service Level Agreement - Uptime guarantee               |
| **Blue-Green** | Deployment technique with instant rollback capability    |
| **Canary**     | Gradual rollout to small percentage of users first       |

---

## Recommended Reading

- PostgreSQL Multi-Tenancy Guide
- Designing Data-Intensive Applications (DDIA)
- The Twelve-Factor App
- Release It! (stability patterns)

---

For deployment guidance, see [ONBOARDING-ENTERPRISE.md](ONBOARDING-ENTERPRISE.md)

For scaling planning, see [SCALING-CHECKLIST.md](SCALING-CHECKLIST.md)
