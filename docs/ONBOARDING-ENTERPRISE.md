# Enterprise Onboarding Guide

Complete step-by-step instructions for deploying AI Integration Boilerplate in enterprise environments with production-grade security, scalability, and compliance considerations.

## Pre-Deployment Checklist

### Infrastructure Requirements

- [ ] Kubernetes cluster or managed container orchestration (ECS, AKS, GKE)
- [ ] PostgreSQL 13+ with automatic backups and replication
- [ ] Redis 6+ with persistence and high availability setup
- [ ] Load balancer with SSL termination
- [ ] CDN configured for static assets
- [ ] Log aggregation system (DataDog, ELK, Splunk)
- [ ] APM solution for performance monitoring
- [ ] Secrets management service (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault)

### Compliance & Security

- [ ] Security audit of codebase completed
- [ ] Penetration testing scheduled
- [ ] GDPR/CCPA compliance assessment
- [ ] SOC 2 audit timeline established
- [ ] Data retention policies defined
- [ ] Encryption key rotation strategy documented
- [ ] Incident response plan created
- [ ] DLP (Data Loss Prevention) rules configured

### Team Readiness

- [ ] DevOps team trained on Docker, Kubernetes, and deployment pipelines
- [ ] Database administrator assigned for schema management
- [ ] Security officer reviewed architecture
- [ ] Support team onboarded on troubleshooting procedures
- [ ] Documentation reviewed and customized for your organization

## Phase 1: Environment Setup (Days 1-2)

### 1.1 Clone and Initialize Repository

```bash
git clone <your-repo-url> ai-integration-prod
cd ai-integration-prod
pnpm install
```

### 1.2 Configure Environment Variables

Create `.env` with production values:

```
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Database - use managed service connection string
DATABASE_URL=postgresql://user:pass@rds-instance.region.rds.amazonaws.com:5432/aidb_prod

# Redis - use managed service endpoint
REDIS_URL=redis://:password@elasticache-instance.region.cache.amazonaws.com:6379

# Encryption keys - generate secure keys
TENANT_CONFIG_ENCRYPTION_KEY=<generate with: openssl rand -base64 32>

# JWT secrets - use strong random values
JWT_PRIVATE_KEY=<generate with: ssh-keygen -t rsa -b 2048>
JWT_PUBLIC_KEY=<extract from private key>

# External services
AI_API_KEY=<your-anthropic-key>
ACTIVE_AI_PROVIDER=anthropic

# Security settings
CORS_ORIGIN=https://your-domain.com
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Rate limiting - tune for expected load
RATE_LIMIT_USER_MAX=100
RATE_LIMIT_TENANT_MAX=1000
RATE_LIMIT_IP_MAX=50
RATE_LIMIT_WINDOW_MS=900000

# Logging & audit
ENABLE_AUDIT_LOGGING=true
AUDIT_LOG_RETENTION_DAYS=90
LOG_LEVEL=info
```

### 1.3 Configure Backend Environment

Create `packages/backend/.env` with database-specific settings:

```
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@rds-instance.region.rds.amazonaws.com:5432/aidb_prod
REDIS_URL=redis://:password@elasticache-instance.region.cache.amazonaws.com:6379

# Increase connection pool for production
DB_MIN_CONNECTIONS=5
DB_MAX_CONNECTIONS=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=10000
DB_STATEMENT_TIMEOUT=30000

# Webhook configuration
WEBHOOK_RETRY_ATTEMPTS=5
WEBHOOK_RETRY_DELAY_MS=1000
WEBHOOK_TIMEOUT_MS=30000
WEBHOOK_SIGNING_SECRET=<generate: openssl rand -hex 32>
```

### 1.4 Configure Frontend Environment

Create `packages/frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_ANALYTICS_ID=<your-analytics-id>
NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>
```

## Phase 2: Database Initialization (Day 2)

### 2.1 Verify Database Connectivity

```bash
# From backend directory
pnpm --filter backend run db:check
```

Expected output:

```
✅ Database connection successful
✅ Database version: PostgreSQL 13.x
✅ Required extensions available
```

### 2.2 Run Schema Migrations

```bash
pnpm --filter backend run db:migrate
```

Verify migrations completed:

```sql
SELECT * FROM "public"."pgmigrations" ORDER BY run_on;
```

Expected migrations:

- 001_initial_schema
- 002_tenant_ai_config
- 003_audit_logs
- 004_ai_token_usage_caps

### 2.3 Create Initial Tenant (Optional)

If you want an internal test account:

```bash
pnpm --filter backend run db:seed:tenant \
  --name "Your Company" \
  --slug "your-company"
```

### 2.4 Verify Database Security

```sql
-- Verify RLS (Row Level Security) is enabled
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname IN ('tenant', 'auth', 'app')
AND tablename NOT LIKE 'pg%'
ORDER BY schemaname, tablename;

-- Check indexes for performance
SELECT * FROM pg_stat_user_indexes;

-- Verify no unencrypted secrets in database
SELECT * FROM pg_stat_statements
WHERE query LIKE '%password%' OR query LIKE '%key%'
LIMIT 10;
```

## Phase 3: Backend Deployment (Days 3-4)

### 3.1 Build Docker Image

```bash
# Build multi-stage production image
docker build \
  -t ai-integration-backend:1.0.0 \
  --target production \
  -f packages/backend/Dockerfile .

# Tag for registry
docker tag ai-integration-backend:1.0.0 \
  registry.your-domain.com/ai-integration-backend:1.0.0

# Push to registry
docker push registry.your-domain.com/ai-integration-backend:1.0.0
```

### 3.2 Deploy to Kubernetes (Example)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-integration-backend
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: ai-integration-backend
    spec:
      containers:
        - name: backend
          image: registry.your-domain.com/ai-integration-backend:1.0.0
          ports:
            - containerPort: 3001
          env:
            - name: NODE_ENV
              value: 'production'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: backend-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: backend-secrets
                  key: redis-url
          resources:
            requests:
              memory: '512Mi'
              cpu: '250m'
            limits:
              memory: '2Gi'
              cpu: '1000m'
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 5
```

### 3.3 Verify Backend Health

```bash
curl -i https://api.your-domain.com/health
```

Expected response:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "database": "connected",
  "redis": "connected",
  "version": "1.0.0"
}
```

## Phase 4: Frontend Deployment (Days 4-5)

### 4.1 Build Production Bundle

```bash
pnpm --filter frontend build
```

### 4.2 Deploy to CDN/Edge

```bash
# Build and export static assets
pnpm --filter frontend export

# Deploy to S3 + CloudFront
aws s3 sync out/ s3://your-frontend-bucket/
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

### 4.3 Configure SSL Certificate

```bash
# Example: Let's Encrypt with auto-renewal
certbot certonly --dns-route53 \
  -d your-domain.com \
  -d *.your-domain.com

# Copy certificate to load balancer
# Configure auto-renewal in cron
```

## Phase 5: Post-Deployment Verification (Day 5)

### 5.1 End-to-End Health Checks

```bash
# Frontend availability
curl -i https://your-domain.com

# API availability
curl -i https://api.your-domain.com/health

# Authentication flow
curl -X POST https://api.your-domain.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TempPassword123"}'

# WebSocket connectivity
wscat -c wss://api.your-domain.com/ws/chat

# File upload capability
curl -F "file=@test.pdf" \
  https://api.your-domain.com/uploads \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5.2 Performance Baseline

- [ ] Frontend page load time: < 2 seconds
- [ ] API response time (p95): < 200ms
- [ ] Database query time (p95): < 100ms
- [ ] WebSocket connection time: < 500ms
- [ ] Error rate: < 0.1%

### 5.3 Security Verification

- [ ] HTTPS only (no HTTP fallback)
- [ ] Security headers present (CSP, HSTS, X-Frame-Options)
- [ ] CORS configured correctly
- [ ] Rate limiting active
- [ ] Audit logging recording all mutations
- [ ] JWT tokens validated on every request
- [ ] Secrets not exposed in logs

### 5.4 Monitoring Setup

- [ ] Log aggregation collecting all services
- [ ] APM spans capturing request flows
- [ ] Alerts configured for:
  - Error rate > 1%
  - Response time p95 > 1s
  - Database connections at 80% capacity
  - Redis memory at 80% capacity
  - Disk usage at 80% capacity

## Phase 6: Team Handoff (Day 5+)

### 6.1 Operations Documentation

Create team-specific docs covering:

- Deployment procedures
- Rollback procedures
- Incident response
- On-call escalation
- Database backup/restore
- Log access procedures

### 6.2 Runbooks for Common Issues

- [ ] How to scale backend replicas
- [ ] How to increase database pool
- [ ] How to restart services without data loss
- [ ] How to check logs for errors
- [ ] How to recover from database failure

### 6.3 User Access Training

- [ ] Admin dashboard walkthrough
- [ ] Session management
- [ ] Audit log review
- [ ] Tenant creation/management
- [ ] Usage reporting

## Rollback Plan

If issues arise post-deployment:

1. **Immediate** (< 5 min): Point traffic to previous version via load balancer
2. **Short-term** (5-30 min): Revert database schema (if applicable)
3. **Investigation** (30+ min): Collect logs, identify root cause, plan fix

Keep previous version container images in registry for quick rollback.

## Success Criteria

Enterprise deployment is complete when:

- ✅ All systems operational and healthy
- ✅ Team trained and confident
- ✅ Monitoring and alerting active
- ✅ Runbooks complete and tested
- ✅ Security audit passed
- ✅ Performance baselines met
- ✅ Backup/restore tested
- ✅ On-call procedures established

## Next Steps

After successful deployment, refer to:

- [SCALING-CHECKLIST.md](SCALING-CHECKLIST.md) - For growth planning
- [PREMIUM-SUPPORT.md](PREMIUM-SUPPORT.md) - For ongoing support
- [API.md](API.md) - For API integration details
