/**
 * Typed Database Client
 *
 * Centralized query layer with automatic tenant context injection.
 * No raw pg queries should be used in controllers - use this client instead.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { TenantDatabase } from './tenant-context';

// ============================================================================
// Connection Pool Configuration
// ============================================================================

export interface DatabasePoolConfig {
  connectionString: string;
  // Pool sizing
  min?: number; // Minimum connections in pool (default: 2)
  max?: number; // Maximum connections in pool (default: 10)
  // Timeouts
  idleTimeoutMillis?: number; // Close idle clients after (default: 30000)
  connectionTimeoutMillis?: number; // Return error after (default: 5000)
  statementTimeout?: number; // Query timeout in ms (default: 30000)
  queryTimeout?: number; // Alternative query timeout (default: 30000)
  // Health checks
  allowExitOnIdle?: boolean; // Allow pool to close when idle (default: false)
  // SSL
  ssl?: boolean | { rejectUnauthorized: boolean };
}

/**
 * Default pool configuration optimized for multi-tenant SaaS
 *
 * Recommended pool sizes:
 * - Small (1-10 concurrent users): min=2, max=10
 * - Medium (10-50 concurrent users): min=5, max=20
 * - Large (50-200 concurrent users): min=10, max=50
 * - Enterprise (200+ concurrent users): min=20, max=100 or use PgBouncer
 *
 * Formula: max_connections = (num_workers * pool_max) + overhead
 * Example: 4 workers * 20 pool_max = 80 connections + 20 overhead = 100 PostgreSQL max_connections
 */
const DEFAULT_POOL_CONFIG: Partial<DatabasePoolConfig> = {
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10),
  statementTimeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),
  queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10),
  allowExitOnIdle: process.env.DB_POOL_ALLOW_EXIT_ON_IDLE === 'true',
};

/**
 * Create a pool configuration with sensible defaults
 */
export function createPoolConfig(overrides?: Partial<DatabasePoolConfig>): PoolConfig {
  const config: PoolConfig = {
    connectionString: overrides?.connectionString || process.env.DATABASE_URL,
    min: overrides?.min ?? DEFAULT_POOL_CONFIG.min,
    max: overrides?.max ?? DEFAULT_POOL_CONFIG.max,
    idleTimeoutMillis: overrides?.idleTimeoutMillis ?? DEFAULT_POOL_CONFIG.idleTimeoutMillis,
    connectionTimeoutMillis:
      overrides?.connectionTimeoutMillis ?? DEFAULT_POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: overrides?.statementTimeout ?? DEFAULT_POOL_CONFIG.statementTimeout,
    query_timeout: overrides?.queryTimeout ?? DEFAULT_POOL_CONFIG.queryTimeout,
    allowExitOnIdle: overrides?.allowExitOnIdle ?? DEFAULT_POOL_CONFIG.allowExitOnIdle,
    ssl:
      overrides?.ssl ?? (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined),
  };

  // Log pool configuration in development
  if (process.env.NODE_ENV === 'development') {
    console.log('📊 Database Pool Configuration:');
    console.log(`   Min connections: ${config.min}`);
    console.log(`   Max connections: ${config.max}`);
    console.log(`   Idle timeout: ${config.idleTimeoutMillis}ms`);
    console.log(`   Connection timeout: ${config.connectionTimeoutMillis}ms`);
    console.log(`   Statement timeout: ${config.statement_timeout}ms`);
  }

  return config;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface Tenant {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial' | 'cancelled';
  plan: string;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  email_verified: boolean;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'pending_verification';
  last_login_at: Date | null;
  last_login_ip: string | null;
  login_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'invited' | 'suspended';
  invited_at: Date | null;
  joined_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'archived' | 'deleted';
  visibility: 'private' | 'internal' | 'public';
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // Aggregated fields
  member_count?: number;
  task_count?: number;
  completed_task_count?: number;
}

export interface Task {
  id: string;
  tenant_id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  type: string;
  assignee_id: string | null;
  reporter_id: string;
  due_date: Date | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  deleted_at: Date | null;
  // Joined fields
  assignee_first_name?: string;
  assignee_last_name?: string;
  assignee_avatar_url?: string | null;
  reporter_first_name?: string;
  reporter_last_name?: string;
  project_name?: string;
  project_slug?: string;
}

export interface Comment {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  parent_id: string | null;
  content: string;
  author_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // Joined fields
  author_first_name?: string;
  author_last_name?: string;
  author_avatar_url?: string | null;
}

export interface Tag {
  id: string;
  tenant_id: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActivityLogEntry {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  actor_type: string;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateTenantInput {
  name: string;
  slug: string;
  plan?: string;
  settings?: Record<string, unknown>;
}

export interface CreateUserInput {
  email: string;
  password_hash?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserInput {
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
  visibility?: 'private' | 'internal' | 'public';
  settings?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
  visibility?: 'private' | 'internal' | 'public';
  settings?: Record<string, unknown>;
}

export interface CreateTaskInput {
  project_id: string;
  parent_id?: string;
  title: string;
  description?: string;
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  type?: string;
  assignee_id?: string;
  due_date?: Date;
  estimated_hours?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id?: string | null;
  due_date?: Date | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateCommentInput {
  entity_type: string;
  entity_id: string;
  parent_id?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCommentInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  description?: string;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface TaskFilter {
  project_id?: string;
  status?: string | string[];
  priority?: string | string[];
  assignee_id?: string | null;
  reporter_id?: string;
  tags?: string[];
  search?: string;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// ============================================================================
// Database Client Class
// ============================================================================

export class DatabaseClient {
  private pool: Pool;
  private tenantDb: TenantDatabase;

  constructor(pool: Pool) {
    this.pool = pool;
    this.tenantDb = TenantDatabase.fromPool(pool);
  }

  // ==========================================================================
  // Tenant Operations
  // ==========================================================================

  tenants = {
    create: async (input: CreateTenantInput): Promise<Tenant> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        const result = await client.query<Tenant>(
          `INSERT INTO tenant.tenants (name, slug, plan, settings)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [input.name, input.slug, input.plan || 'free', JSON.stringify(input.settings || {})]
        );
        return result.rows[0];
      } finally {
        client.release();
      }
    },

    getById: async (id: string): Promise<Tenant | null> => {
      return this.tenantDb.withTenant(id, async (client) => {
        const result = await client.query<Tenant>('SELECT * FROM tenant.tenants WHERE id = $1', [
          id,
        ]);
        return result.rows[0] || null;
      });
    },

    getBySlug: async (slug: string): Promise<Tenant | null> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        const result = await client.query<Tenant>('SELECT * FROM tenant.tenants WHERE slug = $1', [
          slug,
        ]);
        return result.rows[0] || null;
      } finally {
        client.release();
      }
    },

    updateSettings: async (tenantId: string, settings: Record<string, unknown>): Promise<void> => {
      await this.tenantDb.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE tenant.tenants SET settings = settings || $1::jsonb WHERE id = $2`,
          [JSON.stringify(settings), tenantId]
        );
      });
    },
  };

  // ==========================================================================
  // User Operations
  // ==========================================================================

  users = {
    create: async (tenantId: string, input: CreateUserInput): Promise<User> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<User>(
          `INSERT INTO auth.users (tenant_id, email, password_hash, first_name, last_name, phone, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            input.email,
            input.password_hash,
            input.first_name,
            input.last_name,
            input.phone,
            JSON.stringify(input.metadata || {}),
          ]
        );
        return result.rows[0];
      });
    },

    getById: async (tenantId: string, userId: string): Promise<User | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<User>(
          'SELECT * FROM auth.users WHERE id = $1 AND deleted_at IS NULL',
          [userId]
        );
        return result.rows[0] || null;
      });
    },

    getByEmail: async (tenantId: string, email: string): Promise<User | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<User>(
          'SELECT * FROM auth.users WHERE email = $1 AND deleted_at IS NULL',
          [email]
        );
        return result.rows[0] || null;
      });
    },

    list: async (tenantId: string): Promise<User[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<User>(
          `SELECT id, email, first_name, last_name, avatar_url, status, email_verified, 
                  created_at, last_login_at
           FROM auth.users 
           WHERE deleted_at IS NULL 
           ORDER BY created_at DESC`
        );
        return result.rows;
      });
    },

    update: async (
      tenantId: string,
      userId: string,
      input: UpdateUserInput
    ): Promise<User | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (input.first_name !== undefined) {
          sets.push(`first_name = $${paramIndex++}`);
          values.push(input.first_name);
        }
        if (input.last_name !== undefined) {
          sets.push(`last_name = $${paramIndex++}`);
          values.push(input.last_name);
        }
        if (input.avatar_url !== undefined) {
          sets.push(`avatar_url = $${paramIndex++}`);
          values.push(input.avatar_url);
        }
        if (input.phone !== undefined) {
          sets.push(`phone = $${paramIndex++}`);
          values.push(input.phone);
        }
        if (input.metadata !== undefined) {
          sets.push(`metadata = metadata || $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(input.metadata));
        }

        if (sets.length === 0) {
          return this.users.getById(tenantId, userId);
        }

        values.push(userId);
        const result = await client.query<User>(
          `UPDATE auth.users SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        return result.rows[0] || null;
      });
    },

    softDelete: async (tenantId: string, userId: string): Promise<boolean> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE auth.users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
          [userId]
        );
        return (result.rowCount ?? 0) > 0;
      });
    },

    updateLastLogin: async (
      tenantId: string,
      userId: string,
      ipAddress?: string
    ): Promise<void> => {
      await this.tenantDb.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE auth.users 
           SET last_login_at = NOW(), last_login_ip = $1, login_count = login_count + 1
           WHERE id = $2`,
          [ipAddress, userId]
        );
      });
    },

    verifyEmail: async (tenantId: string, userId: string): Promise<void> => {
      await this.tenantDb.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE auth.users SET email_verified = TRUE, status = 'active' WHERE id = $1`,
          [userId]
        );
      });
    },
  };

  // ==========================================================================
  // Tenant Members Operations
  // ==========================================================================

  members = {
    add: async (
      tenantId: string,
      userId: string,
      role: TenantMember['role'] = 'member'
    ): Promise<TenantMember> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        const result = await client.query<TenantMember>(
          `INSERT INTO tenant.tenant_members (tenant_id, user_id, role, status, joined_at)
           VALUES ($1, $2, $3, 'active', NOW())
           RETURNING *`,
          [tenantId, userId, role]
        );
        return result.rows[0];
      } finally {
        client.release();
      }
    },

    list: async (tenantId: string): Promise<TenantMember[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<TenantMember>(
          `SELECT tm.*, u.email, u.first_name, u.last_name
           FROM tenant.tenant_members tm
           JOIN auth.users u ON tm.user_id = u.id
           WHERE tm.tenant_id = $1
           ORDER BY tm.role, tm.created_at`,
          [tenantId]
        );
        return result.rows;
      });
    },

    getRole: async (tenantId: string, userId: string): Promise<TenantMember['role'] | null> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        const result = await client.query<{ role: TenantMember['role'] }>(
          `SELECT role FROM tenant.tenant_members
           WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
          [tenantId, userId]
        );
        return result.rows[0]?.role || null;
      } finally {
        client.release();
      }
    },

    isMember: async (tenantId: string, userId: string): Promise<boolean> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        const result = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM tenant.tenant_members
             WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
           )`,
          [tenantId, userId]
        );
        return result.rows[0].exists;
      } finally {
        client.release();
      }
    },

    remove: async (tenantId: string, userId: string): Promise<void> => {
      const client = await this.tenantDb.getRawConnection();
      try {
        await client.query(
          'DELETE FROM tenant.tenant_members WHERE tenant_id = $1 AND user_id = $2',
          [tenantId, userId]
        );
      } finally {
        client.release();
      }
    },
  };

  // ==========================================================================
  // Project Operations
  // ==========================================================================

  projects = {
    create: async (
      tenantId: string,
      userId: string,
      input: CreateProjectInput
    ): Promise<Project> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Project>(
          `INSERT INTO app.projects (tenant_id, name, slug, description, visibility, settings, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            input.name,
            input.slug,
            input.description,
            input.visibility || 'private',
            JSON.stringify(input.settings || {}),
            userId,
          ]
        );

        // Add creator as owner
        await client.query(
          `INSERT INTO app.project_members (tenant_id, project_id, user_id, role)
           VALUES ($1, $2, $3, 'owner')`,
          [tenantId, result.rows[0].id, userId]
        );

        return result.rows[0];
      });
    },

    getById: async (tenantId: string, projectId: string): Promise<Project | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Project>(
          `SELECT p.*, 
                  COUNT(DISTINCT pm.user_id) as member_count,
                  COUNT(DISTINCT t.id) as task_count,
                  COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as completed_task_count
           FROM app.projects p
           LEFT JOIN app.project_members pm ON p.id = pm.project_id
           LEFT JOIN app.tasks t ON p.id = t.project_id AND t.deleted_at IS NULL
           WHERE p.id = $1 AND p.deleted_at IS NULL
           GROUP BY p.id`,
          [projectId]
        );
        return result.rows[0] || null;
      });
    },

    list: async (tenantId: string, options?: PaginationOptions): Promise<Project[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const limit = options?.limit || 50;
        const offset = options?.offset || 0;

        const result = await client.query<Project>(
          `SELECT p.*, 
                  COUNT(DISTINCT pm.user_id) as member_count,
                  COUNT(DISTINCT t.id) as task_count
           FROM app.projects p
           LEFT JOIN app.project_members pm ON p.id = pm.project_id
           LEFT JOIN app.tasks t ON p.id = t.project_id AND t.deleted_at IS NULL
           WHERE p.deleted_at IS NULL
           GROUP BY p.id
           ORDER BY p.created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        return result.rows;
      });
    },

    listForUser: async (tenantId: string, userId: string): Promise<Project[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Project>(
          `SELECT p.*, pm.role as user_role
           FROM app.projects p
           JOIN app.project_members pm ON p.id = pm.project_id
           WHERE pm.user_id = $1 AND p.deleted_at IS NULL
           ORDER BY p.updated_at DESC`,
          [userId]
        );
        return result.rows;
      });
    },

    update: async (
      tenantId: string,
      projectId: string,
      userId: string,
      input: UpdateProjectInput
    ): Promise<Project | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const sets: string[] = ['updated_by = $1'];
        const values: unknown[] = [userId];
        let paramIndex = 2;

        if (input.name !== undefined) {
          sets.push(`name = $${paramIndex++}`);
          values.push(input.name);
        }
        if (input.description !== undefined) {
          sets.push(`description = $${paramIndex++}`);
          values.push(input.description);
        }
        if (input.status !== undefined) {
          sets.push(`status = $${paramIndex++}`);
          values.push(input.status);
        }
        if (input.visibility !== undefined) {
          sets.push(`visibility = $${paramIndex++}`);
          values.push(input.visibility);
        }
        if (input.settings !== undefined) {
          sets.push(`settings = settings || $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(input.settings));
        }

        values.push(projectId);
        const result = await client.query<Project>(
          `UPDATE app.projects SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        return result.rows[0] || null;
      });
    },

    softDelete: async (tenantId: string, projectId: string): Promise<boolean> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE app.projects SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
          [projectId]
        );
        return (result.rowCount ?? 0) > 0;
      });
    },

    addMember: async (
      tenantId: string,
      projectId: string,
      userId: string,
      role: string = 'member'
    ): Promise<void> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO app.project_members (tenant_id, project_id, user_id, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, project_id, user_id) DO UPDATE SET role = $4`,
          [tenantId, projectId, userId, role]
        );
      });
    },

    removeMember: async (tenantId: string, projectId: string, userId: string): Promise<void> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        await client.query(
          'DELETE FROM app.project_members WHERE project_id = $1 AND user_id = $2',
          [projectId, userId]
        );
      });
    },

    getMembers: async (tenantId: string, projectId: string): Promise<TenantMember[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<TenantMember>(
          `SELECT pm.*, u.email, u.first_name, u.last_name, u.avatar_url
           FROM app.project_members pm
           JOIN auth.users u ON pm.user_id = u.id
           WHERE pm.project_id = $1
           ORDER BY pm.role, pm.created_at`,
          [projectId]
        );
        return result.rows;
      });
    },
  };

  // ==========================================================================
  // Task Operations
  // ==========================================================================

  tasks = {
    create: async (tenantId: string, userId: string, input: CreateTaskInput): Promise<Task> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Task>(
          `INSERT INTO app.tasks (tenant_id, project_id, parent_id, title, description, status, priority, type, assignee_id, reporter_id, due_date, estimated_hours, tags, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            tenantId,
            input.project_id,
            input.parent_id,
            input.title,
            input.description,
            input.status || 'todo',
            input.priority || 'medium',
            input.type || 'task',
            input.assignee_id,
            userId,
            input.due_date,
            input.estimated_hours,
            input.tags || [],
            JSON.stringify(input.metadata || {}),
          ]
        );
        return result.rows[0];
      });
    },

    getById: async (tenantId: string, taskId: string): Promise<Task | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Task>(
          `SELECT t.*,
                  assignee.first_name as assignee_first_name,
                  assignee.last_name as assignee_last_name,
                  assignee.avatar_url as assignee_avatar_url,
                  reporter.first_name as reporter_first_name,
                  reporter.last_name as reporter_last_name,
                  p.name as project_name,
                  p.slug as project_slug
           FROM app.tasks t
           LEFT JOIN auth.users assignee ON t.assignee_id = assignee.id
           LEFT JOIN auth.users reporter ON t.reporter_id = reporter.id
           JOIN app.projects p ON t.project_id = p.id
           WHERE t.id = $1 AND t.deleted_at IS NULL`,
          [taskId]
        );
        return result.rows[0] || null;
      });
    },

    list: async (
      tenantId: string,
      filter?: TaskFilter,
      options?: PaginationOptions & SortOptions
    ): Promise<Task[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const conditions: string[] = ['t.deleted_at IS NULL'];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (filter?.project_id) {
          conditions.push(`t.project_id = $${paramIndex++}`);
          values.push(filter.project_id);
        }
        if (filter?.status) {
          if (Array.isArray(filter.status)) {
            conditions.push(`t.status = ANY($${paramIndex++})`);
            values.push(filter.status);
          } else {
            conditions.push(`t.status = $${paramIndex++}`);
            values.push(filter.status);
          }
        }
        if (filter?.priority) {
          if (Array.isArray(filter.priority)) {
            conditions.push(`t.priority = ANY($${paramIndex++})`);
            values.push(filter.priority);
          } else {
            conditions.push(`t.priority = $${paramIndex++}`);
            values.push(filter.priority);
          }
        }
        if (filter?.assignee_id !== undefined) {
          if (filter.assignee_id === null) {
            conditions.push('t.assignee_id IS NULL');
          } else {
            conditions.push(`t.assignee_id = $${paramIndex++}`);
            values.push(filter.assignee_id);
          }
        }
        if (filter?.reporter_id) {
          conditions.push(`t.reporter_id = $${paramIndex++}`);
          values.push(filter.reporter_id);
        }
        if (filter?.tags && filter.tags.length > 0) {
          conditions.push(`t.tags && $${paramIndex++}`);
          values.push(filter.tags);
        }
        if (filter?.search) {
          conditions.push(`(t.title ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex})`);
          values.push(`%${filter.search}%`);
          paramIndex++;
        }

        const limit = options?.limit || 50;
        const offset = options?.offset || 0;
        const sortField = options?.field || 'created_at';
        const sortDirection = options?.direction || 'desc';
        const limitParam = paramIndex;
        const offsetParam = paramIndex + 1;

        const result = await client.query<Task>(
          `SELECT t.*,
                  assignee.first_name as assignee_first_name,
                  assignee.last_name as assignee_last_name,
                  assignee.avatar_url as assignee_avatar_url,
                  reporter.first_name as reporter_first_name,
                  reporter.last_name as reporter_last_name,
                  p.name as project_name,
                  p.slug as project_slug
           FROM app.tasks t
           LEFT JOIN auth.users assignee ON t.assignee_id = assignee.id
           LEFT JOIN auth.users reporter ON t.reporter_id = reporter.id
           JOIN app.projects p ON t.project_id = p.id
           WHERE ${conditions.join(' AND ')}
           ORDER BY t.${sortField} ${sortDirection}
           LIMIT $${limitParam} OFFSET $${offsetParam}`,
          [...values, limit, offset]
        );
        return result.rows;
      });
    },

    update: async (
      tenantId: string,
      taskId: string,
      input: UpdateTaskInput
    ): Promise<Task | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (input.title !== undefined) {
          sets.push(`title = $${paramIndex++}`);
          values.push(input.title);
        }
        if (input.description !== undefined) {
          sets.push(`description = $${paramIndex++}`);
          values.push(input.description);
        }
        if (input.status !== undefined) {
          sets.push(`status = $${paramIndex++}`);
          values.push(input.status);
          if (input.status === 'done') {
            sets.push('completed_at = NOW()');
          }
        }
        if (input.priority !== undefined) {
          sets.push(`priority = $${paramIndex++}`);
          values.push(input.priority);
        }
        if (input.assignee_id !== undefined) {
          sets.push(`assignee_id = $${paramIndex++}`);
          values.push(input.assignee_id);
        }
        if (input.due_date !== undefined) {
          sets.push(`due_date = $${paramIndex++}`);
          values.push(input.due_date);
        }
        if (input.estimated_hours !== undefined) {
          sets.push(`estimated_hours = $${paramIndex++}`);
          values.push(input.estimated_hours);
        }
        if (input.actual_hours !== undefined) {
          sets.push(`actual_hours = $${paramIndex++}`);
          values.push(input.actual_hours);
        }
        if (input.tags !== undefined) {
          sets.push(`tags = $${paramIndex++}`);
          values.push(input.tags);
        }
        if (input.metadata !== undefined) {
          sets.push(`metadata = metadata || $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(input.metadata));
        }

        if (sets.length === 0) {
          return this.tasks.getById(tenantId, taskId);
        }

        values.push(taskId);
        const result = await client.query<Task>(
          `UPDATE app.tasks SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        return result.rows[0] || null;
      });
    },

    softDelete: async (tenantId: string, taskId: string): Promise<boolean> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE app.tasks SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
          [taskId]
        );
        return (result.rowCount ?? 0) > 0;
      });
    },
  };

  // ==========================================================================
  // Comment Operations
  // ==========================================================================

  comments = {
    create: async (
      tenantId: string,
      userId: string,
      input: CreateCommentInput
    ): Promise<Comment> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Comment>(
          `INSERT INTO app.comments (tenant_id, entity_type, entity_id, parent_id, content, author_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            input.entity_type,
            input.entity_id,
            input.parent_id,
            input.content,
            userId,
            JSON.stringify(input.metadata || {}),
          ]
        );
        return result.rows[0];
      });
    },

    listForEntity: async (
      tenantId: string,
      entityType: string,
      entityId: string
    ): Promise<Comment[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Comment>(
          `SELECT c.*, u.first_name as author_first_name, u.last_name as author_last_name, u.avatar_url as author_avatar_url
           FROM app.comments c
           JOIN auth.users u ON c.author_id = u.id
           WHERE c.entity_type = $1 AND c.entity_id = $2 AND c.deleted_at IS NULL
           ORDER BY c.created_at ASC`,
          [entityType, entityId]
        );
        return result.rows;
      });
    },

    update: async (
      tenantId: string,
      commentId: string,
      input: UpdateCommentInput
    ): Promise<Comment | null> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Comment>(
          `UPDATE app.comments SET content = $1, metadata = metadata || $2::jsonb WHERE id = $3 RETURNING *`,
          [input.content, JSON.stringify(input.metadata || {}), commentId]
        );
        return result.rows[0] || null;
      });
    },

    softDelete: async (tenantId: string, commentId: string): Promise<boolean> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE app.comments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
          [commentId]
        );
        return (result.rowCount ?? 0) > 0;
      });
    },
  };

  // ==========================================================================
  // Tag Operations
  // ==========================================================================

  tags = {
    create: async (tenantId: string, input: CreateTagInput): Promise<Tag> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Tag>(
          `INSERT INTO app.tags (tenant_id, name, color, description) VALUES ($1, $2, $3, $4) RETURNING *`,
          [tenantId, input.name, input.color, input.description]
        );
        return result.rows[0];
      });
    },

    list: async (tenantId: string): Promise<Tag[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<Tag>(
          'SELECT * FROM app.tags WHERE tenant_id = $1 ORDER BY name',
          [tenantId]
        );
        return result.rows;
      });
    },

    delete: async (tenantId: string, tagId: string): Promise<boolean> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query('DELETE FROM app.tags WHERE id = $1', [tagId]);
        return (result.rowCount ?? 0) > 0;
      });
    },
  };

  // ==========================================================================
  // Activity Log Operations
  // ==========================================================================

  activityLog = {
    create: async (
      tenantId: string,
      entityType: string,
      entityId: string,
      action: string,
      actorId: string,
      changes?: Record<string, unknown>,
      metadata?: Record<string, unknown>
    ): Promise<ActivityLogEntry> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<ActivityLogEntry>(
          `INSERT INTO app.activity_log (tenant_id, entity_type, entity_id, action, actor_id, changes, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            entityType,
            entityId,
            action,
            actorId,
            JSON.stringify(changes),
            JSON.stringify(metadata || {}),
          ]
        );
        return result.rows[0];
      });
    },

    listForEntity: async (
      tenantId: string,
      entityType: string,
      entityId: string,
      limit: number = 50
    ): Promise<ActivityLogEntry[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<ActivityLogEntry>(
          `SELECT * FROM app.activity_log
           WHERE entity_type = $1 AND entity_id = $2
           ORDER BY created_at DESC
           LIMIT $3`,
          [entityType, entityId, limit]
        );
        return result.rows;
      });
    },

    listRecent: async (tenantId: string, limit: number = 100): Promise<ActivityLogEntry[]> => {
      return this.tenantDb.withTenant(tenantId, async (client) => {
        const result = await client.query<ActivityLogEntry>(
          `SELECT * FROM app.activity_log
           WHERE tenant_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [tenantId, limit]
        );
        return result.rows;
      });
    },
  };

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  async withTransaction<T>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT app.set_tenant_context($1)', [tenantId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({ connectionString });
  return new DatabaseClient(pool);
}

export default DatabaseClient;
