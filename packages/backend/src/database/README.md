# Multi-Tenant PostgreSQL Schema Documentation

## Overview

This schema implements **row-level multi-tenancy** using PostgreSQL's Row-Level Security (RLS) feature. Every table includes a `tenant_id` column, and RLS policies enforce tenant isolation at the database level, ensuring complete data segregation between tenants.

## Architecture

### Schema Organization

The database is organized into three logical schemas:

```
├── tenant/          # Tenant management and membership
├── auth/            # Authentication, users, roles, permissions
└── app/             # Application business logic
```

### Key Design Principles

1. **Tenant ID on Every Table**: Every table has a `tenant_id` column for row-level isolation
2. **Row-Level Security (RLS)**: PostgreSQL RLS policies enforce tenant boundaries
3. **Session Context**: Tenant context is set per-session using `app.set_tenant_context()`
4. **Soft Deletes**: Tables use `deleted_at` for soft deletion
5. **Audit Columns**: All tables include `created_at` and `updated_at` timestamps
6. **UUID Primary Keys**: Using UUIDs for distributed system compatibility

## Database Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TENANT SCHEMA                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  tenants ───────┬──── tenant_members ──── auth.users                     │
│                 └──── tenant_invitations                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           AUTH SCHEMA                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  users ─────────┬──── user_sessions                                      │
│                 ├──── user_roles ──────── role_permissions               │
│                 └─────────────────────── permissions                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                            APP SCHEMA                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  projects ──────┬──── project_members                                    │
│                 └──── tasks ──────────── comments                        │
│                                      ──── attachments                    │
│  activity_log                                                           │
│  tags                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Tables

### tenant.tenants

Root table for tenant definitions. Each tenant is an isolated organization.

| Column    | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| id        | UUID    | Primary key                              |
| tenant_id | UUID    | Self-referencing for RLS (must equal id) |
| name      | VARCHAR | Display name                             |
| slug      | VARCHAR | URL-safe identifier (unique)             |
| status    | VARCHAR | active/suspended/trial/cancelled         |
| plan      | VARCHAR | Subscription plan                        |
| settings  | JSONB   | Tenant-specific settings                 |
| metadata  | JSONB   | Additional metadata                      |

### auth.users

User accounts. Users can belong to multiple tenants via tenant_members.

| Column         | Type    | Description                                    |
| -------------- | ------- | ---------------------------------------------- |
| id             | UUID    | Primary key                                    |
| tenant_id      | UUID    | Owning tenant                                  |
| email          | VARCHAR | Email (unique globally)                        |
| email_verified | BOOLEAN | Email verification status                      |
| password_hash  | VARCHAR | Hashed password                                |
| first_name     | VARCHAR | First name                                     |
| last_name      | VARCHAR | Last name                                      |
| avatar_url     | TEXT    | Profile image URL                              |
| status         | VARCHAR | active/inactive/suspended/pending_verification |

### app.projects

Projects belonging to a tenant.

| Column      | Type    | Description             |
| ----------- | ------- | ----------------------- |
| id          | UUID    | Primary key             |
| tenant_id   | UUID    | Owning tenant           |
| name        | VARCHAR | Project name            |
| slug        | VARCHAR | URL-safe identifier     |
| description | TEXT    | Project description     |
| status      | VARCHAR | active/archived/deleted |
| visibility  | VARCHAR | private/internal/public |
| settings    | JSONB   | Project settings        |
| created_by  | UUID    | Creator user ID         |

### app.tasks

Work items within a project, supporting hierarchies.

| Column      | Type        | Description                            |
| ----------- | ----------- | -------------------------------------- |
| id          | UUID        | Primary key                            |
| tenant_id   | UUID        | Owning tenant                          |
| project_id  | UUID        | Parent project                         |
| parent_id   | UUID        | Parent task (for subtasks)             |
| title       | VARCHAR     | Task title                             |
| description | TEXT        | Task description                       |
| status      | VARCHAR     | todo/in_progress/review/done/cancelled |
| priority    | VARCHAR     | low/medium/high/urgent                 |
| assignee_id | UUID        | Assigned user                          |
| reporter_id | UUID        | Reporting user                         |
| due_date    | TIMESTAMPTZ | Due date                               |
| tags        | TEXT[]      | Task tags                              |

## Row-Level Security (RLS)

### How It Works

1. **Session Context**: At the start of each request, call `app.set_tenant_context(tenant_id)`
2. **Policy Enforcement**: RLS policies automatically filter rows based on the tenant context
3. **No Application Changes**: Queries work normally; RLS is transparent to application code

### Setting Tenant Context

```sql
-- At the start of each request
SELECT app.set_tenant_context('tenant-uuid-here');

-- All subsequent queries are automatically filtered
SELECT * FROM app.projects; -- Only returns projects for the current tenant
```

### RLS Policy Examples

```sql
-- Policy on app.projects table
CREATE POLICY projects_isolation ON app.projects
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policy on app.tasks table
CREATE POLICY tasks_isolation ON app.tasks
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

## Helper Functions

### app.set_tenant_context(p_tenant_id UUID)

Sets the tenant context for the current session.

```sql
SELECT app.set_tenant_context('550e8400-e29b-41d4-a716-446655440000');
```

### app.get_tenant_id()

Returns the current tenant ID from session context.

```sql
SELECT app.get_tenant_id();
-- Returns: 550e8400-e29b-41d4-a716-446655440000
```

### update_updated_at_column()

Trigger function that automatically updates the `updated_at` timestamp.

## Views

### auth.user_tenants

Shows users with their tenant memberships.

```sql
SELECT * FROM auth.user_tenants WHERE user_id = 'user-uuid';
```

### app.project_summary

Projects with aggregated member and task counts.

```sql
SELECT * FROM app.project_summary WHERE tenant_id = app.get_tenant_id();
```

### app.task_details

Tasks with assignee and reporter details.

```sql
SELECT * FROM app.task_details WHERE project_id = 'project-uuid';
```

## Usage Examples

### Creating a New Tenant

```sql
-- Create tenant
INSERT INTO tenant.tenants (name, slug, plan)
VALUES ('Acme Corp', 'acme-corp', 'professional')
RETURNING id;

-- Add owner to tenant
INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at)
VALUES ('tenant-uuid', 'user-uuid', 'owner', 'active', NOW());
```

### Creating a User

```sql
INSERT INTO auth.users (tenant_id, email, first_name, last_name, password_hash)
VALUES ('tenant-uuid', 'john@acme.com', 'John', 'Doe', 'hashed_password');
```

### Creating a Project

```sql
-- First, set tenant context
SELECT app.set_tenant_context('tenant-uuid');

-- Then create project (tenant_id is required by schema, but RLS enforces it)
INSERT INTO app.projects (tenant_id, name, slug, description, created_by)
VALUES (app.get_tenant_id(), 'My Project', 'my-project', 'Project description', 'user-uuid');
```

### Creating Tasks

```sql
INSERT INTO app.tasks (tenant_id, project_id, title, status, priority, reporter_id)
VALUES (
    app.get_tenant_id(),
    'project-uuid',
    'Implement feature X',
    'todo',
    'high',
    'user-uuid'
);
```

### Querying with Tenant Context

```sql
-- Set context once per request
SELECT app.set_tenant_context('tenant-uuid');

-- All queries automatically scoped to tenant
SELECT * FROM app.projects;
SELECT * FROM app.tasks WHERE status = 'todo';
SELECT * FROM auth.users;
```

## TypeScript/Node.js Integration

### Setting Tenant Context in Application Code

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  /* connection config */
});

async function withTenantContext<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    // Set tenant context for this connection
    await client.query('SELECT app.set_tenant_context($1)', [tenantId]);

    // Execute callback with tenant-scoped queries
    return await callback(client);
  } finally {
    client.release();
  }
}

// Usage
const projects = await withTenantContext(tenantId, async (client) => {
  const result = await client.query('SELECT * FROM app.projects');
  return result.rows;
});
```

### Express Middleware Example

```typescript
import { Request, Response, NextFunction } from 'express';

// Middleware to set tenant context
async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];

  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID required' });
  }

  // Set tenant context for this request's database connection
  await req.db.query('SELECT app.set_tenant_context($1)', [tenantId]);

  next();
}
```

## Migration Considerations

### Adding tenant_id to Existing Tables

```sql
-- 1. Add column with default
ALTER TABLE existing_table ADD COLUMN tenant_id UUID NOT NULL DEFAULT 'default-tenant-uuid';

-- 2. Create index
CREATE INDEX idx_existing_table_tenant_id ON existing_table(tenant_id);

-- 3. Enable RLS
ALTER TABLE existing_table ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policy
CREATE POLICY existing_table_isolation ON existing_table
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

## Connection Pooling

### Configuration

The database client uses `pg` connection pooling with configurable settings via environment variables:

```bash
# Pool sizing
DB_POOL_MIN=2                    # Minimum connections (default: 2)
DB_POOL_MAX=10                   # Maximum connections (default: 10)

# Timeouts
DB_POOL_IDLE_TIMEOUT=30000       # Close idle clients after 30s (default: 30000)
DB_POOL_CONNECTION_TIMEOUT=5000  # Return error after 5s (default: 5000)
DB_STATEMENT_TIMEOUT=30000       # Query timeout 30s (default: 30000)
DB_QUERY_TIMEOUT=30000           # Alternative query timeout (default: 30000)

# Other
DB_POOL_ALLOW_EXIT_ON_IDLE=false # Allow pool to close when idle (default: false)
DB_SSL=false                     # Enable SSL for database connections
```

### Recommended Pool Sizes

| Scale      | Concurrent Users | Pool Min | Pool Max | PostgreSQL max_connections |
| ---------- | ---------------- | -------- | -------- | -------------------------- |
| Small      | 1-10             | 2        | 10       | 20                         |
| Medium     | 10-50            | 5        | 20       | 50                         |
| Large      | 50-200           | 10       | 50       | 150                        |
| Enterprise | 200+             | 20       | 100      | Use PgBouncer              |

### Formula for Calculating max_connections

```
PostgreSQL max_connections = (num_app_workers × pool_max) + overhead

Example:
- 4 Node.js workers
- pool_max = 20
- overhead = 20 (for migrations, admin connections)

max_connections = (4 × 20) + 20 = 100
```

### PgBouncer (Enterprise Scale)

For high-traffic applications (200+ concurrent users), use PgBouncer as a connection pooler:

```ini
; pgbouncer.ini
[databases]
myapp = host=127.0.0.1 port=5432 dbname=myapp

[pgbouncer]
listen_port = 6432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

; Pool settings
pool_mode = transaction
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3

; Limits
max_client_conn = 1000
max_db_connections = 100
```

Then update your DATABASE_URL to point to PgBouncer:

```bash
DATABASE_URL=postgresql://user:pass@localhost:6432/myapp
```

### Connection Pool Monitoring

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  /* config */
});

// Monitor pool statistics
setInterval(() => {
  console.log('Pool stats:', {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  });
}, 10000);
```

### Performance Considerations

### Indexing Strategy

Every table includes an index on `tenant_id` as the leading column:

```sql
CREATE INDEX idx_table_tenant_id ON schema.table(tenant_id);
```

For common query patterns, composite indexes are recommended:

```sql
-- For queries filtering by tenant + status
CREATE INDEX idx_tasks_tenant_status ON app.tasks(tenant_id, status);

-- For queries filtering by tenant + assignee
CREATE INDEX idx_tasks_tenant_assignee ON app.tasks(tenant_id, assignee_id);
```

### Query Optimization

1. **Always include tenant_id in WHERE clauses** for optimal index usage
2. **Use the provided views** which are pre-optimized for common queries
3. **Consider partitioning** for very large tables (e.g., activity_log)

## Security Best Practices

1. **Never bypass RLS**: Always use application connections with RLS enabled
2. **Validate tenant access**: Verify user belongs to tenant before setting context
3. **Audit logging**: Use activity_log table to track sensitive operations
4. **Connection pooling**: Use connection pooling with proper context management
5. **Superuser restrictions**: Don't use superuser connections for application queries

## Troubleshooting

### "Tenant context not set" Error

```sql
-- Error: Tenant context not set. Call set_tenant_context() first.
-- Solution: Always call set_tenant_context before queries
SELECT app.set_tenant_context('tenant-uuid');
```

### RLS Policy Not Filtering

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname IN ('tenant', 'auth', 'app');

-- Check current tenant context
SELECT current_setting('app.current_tenant_id', true);
```

### Performance Issues

```sql
-- Check if indexes are being used
EXPLAIN ANALYZE SELECT * FROM app.tasks WHERE tenant_id = app.get_tenant_id();

-- Missing index warning
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname IN ('tenant', 'auth', 'app')
ORDER BY schemaname, tablename;
```

## File Structure

```
packages/backend/src/database/
├── schema.sql          # Main schema definition
├── README.md           # This documentation
├── migrations/         # Migration scripts
│   └── 001_initial.sql
├── seeds/              # Seed data
│   └── development.sql
└── functions/          # Additional functions
    └── audit.sql
```

## Additional Resources

- [PostgreSQL Row-Level Security Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Multi-Tenant SaaS Architecture Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)
- [UUID Best Practices](https://www.postgresql.org/docs/current/datatype-uuid.html)
