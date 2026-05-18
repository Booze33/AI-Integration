# Scaling Checklist

A comprehensive guide for scaling AI Integration Boilerplate from hundreds to millions of users. Use this checklist as you grow to ensure system reliability and performance at each stage.

## Stage 1: 0-1,000 Active Users

**Target Performance**: Sub-200ms API response time, < 0.1% error rate

### Infrastructure

- [ ] Single PostgreSQL instance (m5.large or equivalent)
- [ ] Single Redis instance (cache.m5.large or equivalent)
- [ ] 2-3 backend replicas (1vCPU, 1GB RAM each)
- [ ] Frontend on CDN with PoP in 3+ regions
- [ ] Application load balancer with health checks

### Database

- [ ] Connection pool: 10-20 connections per backend
- [ ] Basic indexing on `tenant_id`, `user_id`, `created_at`
- [ ] Automated nightly backups
- [ ] WAL archiving enabled for point-in-time recovery
- [ ] Query logging enabled (log_min_duration_statement = 1000)

### Caching

- [ ] Redis used for sessions (10-20MB)
- [ ] Cache warming for frequently accessed data
- [ ] TTL: 1 hour for user data, 24 hours for read-only data
- [ ] Memory limit: 256MB with eviction policy `allkeys-lru`

### Monitoring

- [ ] Basic metrics: CPU, memory, disk, network
- [ ] Error rate and response time dashboards
- [ ] Database query performance insights
- [ ] Uptime checks (3-minute intervals)

### Estimated Cost

- AWS/GCP/Azure: $500-1,000/month
- Includes: compute, database, CDN, monitoring

---

## Stage 2: 1,000-10,000 Active Users

**Target Performance**: Sub-300ms API p95, < 0.5% error rate

### Infrastructure

- [ ] PostgreSQL: t3.xlarge with 500GB SSD
- [ ] Redis: cache.r5.xlarge (96GB memory)
- [ ] 4-6 backend replicas (2vCPU, 2GB RAM each)
- [ ] Dedicated ingestion node for webhooks
- [ ] CDN with custom caching rules per endpoint

### Database Optimization

- [ ] Increase connection pool to 30-40 per backend
- [ ] Add composite indexes on common queries:
  ```sql
  CREATE INDEX idx_tasks_tenant_status ON app.tasks(tenant_id, status);
  CREATE INDEX idx_ai_configs_tenant_active ON tenant.ai_configs(tenant_id, is_active);
  ```
- [ ] Partition large tables by `created_at` (monthly)
- [ ] Regular `VACUUM ANALYZE` (daily)
- [ ] Increase `shared_buffers` to 25% of RAM
- [ ] Increase `effective_cache_size` to 75% of RAM
- [ ] Enable `jit` for complex queries

### Caching Strategy Upgrade

- [ ] Session cache: 100-500MB
- [ ] Query result cache for read-heavy endpoints
- [ ] Implement cache coherency patterns (event-based invalidation)
- [ ] Monitor Redis hit ratio (target: > 90%)
- [ ] Memory limit: 2-4GB with multi-tier eviction

### Performance Tuning

- [ ] Enable compression on all HTTP responses
- [ ] Implement request batching for bulk operations
- [ ] Add rate limiting by tenant (not just by user)
- [ ] Lazy-load data in list endpoints (cursor-based pagination)
- [ ] Bundle and minify JavaScript/CSS assets

### Monitoring Enhancements

- [ ] Per-endpoint performance tracking
- [ ] Database slow query log (> 500ms)
- [ ] Redis memory fragmentation ratio < 1.5
- [ ] Backend memory leak detection
- [ ] Distributed tracing on critical paths
- [ ] Weekly performance review automation

### Cost Estimate

- AWS/GCP/Azure: $2,000-4,000/month

---

## Stage 3: 10,000-100,000 Active Users

**Target Performance**: Sub-400ms API p95, < 0.1% error rate

### Infrastructure

- [ ] PostgreSQL: r5.2xlarge with 2TB SSD (read replicas in 2 regions)
- [ ] Redis: Cluster with 3 nodes (cache.r5.2xlarge each)
- [ ] 8-12 backend replicas (4vCPU, 4GB RAM each)
- [ ] Separate read replicas for analytics queries
- [ ] Regional failover configured

### Database Architecture

- [ ] Implement read/write splitting:
  - [ ] Write operations to primary
  - [ ] Read operations to replicas
- [ ] Partition tables by tenant for faster queries:
  ```sql
  CREATE TABLE app.tasks_2024_q1 PARTITION OF app.tasks
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');
  ```
- [ ] Archival strategy for data older than 90 days
- [ ] Connection pooling: PgBouncer with 50-100 connections per backend
- [ ] Background job queue for long-running operations
- [ ] Column-level encryption for sensitive fields

### Advanced Caching

- [ ] Implement Redis Cluster for horizontal scaling
- [ ] Separate cache layers:
  - [ ] L1: In-process cache (100MB per instance)
  - [ ] L2: Redis (distributed, 16GB+)
- [ ] Cache-aside pattern with stale-while-revalidate
- [ ] Event-driven cache invalidation (not time-based)
- [ ] Monitor and optimize for > 95% hit ratio

### Advanced Monitoring & Tracing

- [ ] Distributed tracing on 100% of requests (Jaeger/DataDog)
- [ ] Real User Monitoring (RUM) for frontend
- [ ] Synthetic monitoring from 5+ geographic regions
- [ ] SLA dashboards with 99.9% uptime target
- [ ] Custom metrics for business logic (e.g., file processing time)

### Cost Estimate

- AWS/GCP/Azure: $5,000-10,000/month

---

## Stage 4: 100,000-1,000,000 Active Users

**Target Performance**: Sub-500ms API p95, 99.99% uptime

### Infrastructure

- [ ] Multi-region deployment (3+ regions)
- [ ] PostgreSQL: db.r6i.4xlarge per region
- [ ] Redis Cluster: 6+ nodes per region
- [ ] 20-30 backend replicas per region
- [ ] Global load balancing with GeoDNS
- [ ] Multi-region failover automatic

### Database at Scale

- [ ] Sharding by tenant or geographic region:
  ```
  Tenant A,B,C -> Shard 1 (Region US-East)
  Tenant D,E,F -> Shard 2 (Region EU-West)
  Tenant G,H,I -> Shard 3 (Region Asia-Pacific)
  ```
- [ ] Cross-region replication with < 5s lag
- [ ] Dedicated read replicas per region (5+ replicas)
- [ ] Columnar storage for analytics queries
- [ ] Auto-scaling based on query load

### Advanced Optimization

- [ ] Query optimization AI (ML-based recommendations)
- [ ] Automatic index recommendations
- [ ] Dead code elimination in queries
- [ ] Vectorization of bulk operations
- [ ] Batch processing for non-critical operations

### Resilience & Disaster Recovery

- [ ] Chaos engineering: regular failure simulations
- [ ] Recovery Time Objective (RTO): < 5 minutes
- [ ] Recovery Point Objective (RPO): < 1 minute
- [ ] Cross-region database replication tested monthly
- [ ] Automated runbooks for common failures
- [ ] Multi-region backup strategy

### Cost Estimate

- AWS/GCP/Azure: $15,000-30,000/month

---

## Stage 5: 1,000,000+ Active Users

**Target Performance**: Sub-1s API p99, 99.999% uptime (5 nines)

### Infrastructure

- [ ] Global mesh architecture (5+ regions)
- [ ] Dedicated Kubernetes clusters per region
- [ ] PostgreSQL: db.r6i.8xlarge or larger per region
- [ ] Redis Enterprise for multi-region consistency
- [ ] Content delivery network with edge computing
- [ ] Custom networking optimizations

### Data Architecture

- [ ] Micro-sharding strategy (100+ shards)
- [ ] Graph database for relationship queries
- [ ] Time-series database for metrics
- [ ] Data warehouse (separate from OLTP) for analytics
- [ ] Data lake for raw logs and backups

### Advanced Features

- [ ] Machine learning for capacity prediction
- [ ] Automatic load rebalancing across shards
- [ ] Predictive scaling (scale before peak)
- [ ] Cost optimization through reserved capacity
- [ ] Custom hardware (GPU nodes for AI inference)

### Cost Estimate

- AWS/GCP/Azure: $30,000-100,000+/month
- Consider dedicated support contracts

---

## Database Performance Tuning Reference

### Connection Pool Settings by Stage

| Stage    | Min Connections | Max Connections | Idle Timeout |
| -------- | --------------- | --------------- | ------------ |
| Stage 1  | 5               | 20              | 30s          |
| Stage 2  | 10              | 40              | 30s          |
| Stage 3  | 20              | 80              | 60s          |
| Stage 4  | 50              | 200             | 60s          |
| Stage 5+ | 100             | 500+            | 120s         |

### Redis Memory by Stage

| Stage    | RAM    | Eviction Policy | Hit Ratio Target |
| -------- | ------ | --------------- | ---------------- |
| Stage 1  | 256MB  | volatile-lru    | > 80%            |
| Stage 2  | 2GB    | allkeys-lru     | > 90%            |
| Stage 3  | 8GB    | allkeys-lfu     | > 95%            |
| Stage 4  | 32GB+  | Custom          | > 98%            |
| Stage 5+ | 100GB+ | Cluster         | > 99%            |

---

## Query Optimization Reference

### Before You Scale to Stage 2+

```sql
-- Identify slow queries
SELECT query, calls, mean_exec_time, max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Check missing indexes
SELECT schemaname, tablename, attname
FROM pg_stat_user_tables t
JOIN pg_stat_user_indexes i ON t.relid = i.relid
WHERE idx_scan = 0
AND schemaname NOT IN ('pg_catalog', 'information_schema');

-- Analyze table statistics
ANALYZE app.tasks;
ANALYZE app.ai_token_usage_events;

-- Check sequential scans (should be minimal)
SELECT schemaname, tablename, seq_scan, seq_tup_read
FROM pg_stat_user_tables
WHERE seq_tup_read > 1000000
ORDER BY seq_tup_read DESC;
```

### Key Indexes to Add When Scaling

```sql
-- User queries
CREATE INDEX idx_users_email ON auth.users(email);
CREATE INDEX idx_users_tenant_status ON auth.users(tenant_id, status);

-- Task queries
CREATE INDEX idx_tasks_assignee ON app.tasks(assignee_id, status);
CREATE INDEX idx_tasks_created_at ON app.tasks(created_at DESC);

-- AI usage queries
CREATE INDEX idx_ai_usage_tenant_date ON app.ai_token_usage_events(tenant_id, created_at DESC);
CREATE INDEX idx_ai_usage_user ON app.ai_token_usage_events(user_id, created_at DESC);

-- Audit queries
CREATE INDEX idx_audit_tenant_timestamp ON app.audit_logs(tenant_id, timestamp DESC);
```

---

## Monitoring Metrics by Stage

### Stage 1-2

- [ ] CPU usage < 70%
- [ ] Memory usage < 80%
- [ ] Disk usage < 70%
- [ ] API p95 response time < 300ms
- [ ] Error rate < 1%
- [ ] Database connections < max_connections \* 80%

### Stage 3-4

- [ ] CPU usage < 60%
- [ ] Memory usage < 75%
- [ ] Disk I/O: reads < 50MB/s, writes < 20MB/s
- [ ] API p95 response time < 500ms
- [ ] API p99 response time < 1s
- [ ] Error rate < 0.5%
- [ ] Database replication lag < 100ms
- [ ] Cache hit ratio > 95%

### Stage 5+

- [ ] CPU usage < 50% (headroom for spikes)
- [ ] Memory usage < 70%
- [ ] Disk I/O: reads < 100MB/s, writes < 50MB/s
- [ ] API p95 response time < 500ms
- [ ] API p99 response time < 1s
- [ ] API p99.9 response time < 5s
- [ ] Error rate < 0.1%
- [ ] Availability > 99.99%
- [ ] Database replication lag < 10ms
- [ ] Cache hit ratio > 99%

---

## Checklist for Scaling to Next Stage

Before upgrading to the next stage, verify:

- [ ] All monitoring dashboards operational
- [ ] Performance baselines documented
- [ ] Runbooks updated for new infrastructure
- [ ] Team training completed on new tools
- [ ] Load testing at 1.5x projected peak load passed
- [ ] Failover testing completed successfully
- [ ] Cost projections approved
- [ ] SLA targets achievable
- [ ] Security audit passed for new components
- [ ] Disaster recovery tested

---

## Cost Optimization Tips

1. **Use Reserved Instances** (20-30% savings)
   - Reserve compute for 1-3 year terms at scale

2. **Spot Instances for Non-Critical Work** (60-70% savings)
   - Use for batch jobs, webhooks, background workers

3. **Data Transfer Optimization**
   - Keep backups in same region (no egress charges)
   - Use VPC endpoints for AWS services

4. **Right-Sizing**
   - Monitor actual usage, don't over-provision
   - Use auto-scaling based on metrics, not guesses

5. **Database Optimization**
   - Queries before capacity increases
   - Archival strategies reduce storage costs

---

## When to Hire for Scaling

| Stage     | Recommended Team                            |
| --------- | ------------------------------------------- |
| Stage 1-2 | Existing team + part-time DevOps            |
| Stage 3   | Full-time DevOps engineer                   |
| Stage 4   | DevOps + Database specialist + SRE          |
| Stage 5+  | Full SRE team (4-6 people) + vendor support |

---

## Additional Resources

- [ONBOARDING-ENTERPRISE.md](ONBOARDING-ENTERPRISE.md) - Enterprise deployment
- [Setup-Production.md](Setup-Production.md) - Production setup details
- [API.md](API.md) - API performance guidelines
- [PREMIUM-SUPPORT.md](PREMIUM-SUPPORT.md) - Priority support options
