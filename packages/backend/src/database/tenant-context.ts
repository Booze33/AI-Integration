/**
 * Multi-Tenant Context Management
 *
 * This module provides utilities for managing tenant context in PostgreSQL sessions.
 * It ensures all database queries are automatically scoped to the current tenant
 * using Row-Level Security (RLS).
 *
 * @requires pg package - Install with: pnpm add pg @types/pg
 */

// ============================================================================
// Types
// ============================================================================

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
}

export interface PoolConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export type TenantDatabaseConfig = PoolConfig;

export interface TenantMember {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'invited' | 'suspended';
  joinedAt: Date;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial' | 'cancelled';
  plan: string;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// FIX 1: Typed shape for isTenantMember query result
interface ExistsRow {
  exists: boolean;
}

// FIX 2: Typed shape for getUserTenantRole query result
interface RoleRow {
  role: TenantMember['role'];
}

// FIX 3: Typed shape for inviteToTenant query result
interface TokenRow {
  token: string;
}

// FIX 4: Typed shape for createUser query result
interface IdRow {
  id: string;
}

// ============================================================================
// Tenant Database Manager
// ============================================================================

export interface DatabaseClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

// FIX 5: Typed Express-compatible interfaces instead of `any`
export interface Response {
  status(code: number): Response;
  json(body: unknown): void;
  on(event: string, listener: () => void): void;
}

export type NextFunction = (err?: unknown) => void;

export class TenantDatabase {
  private pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.pool = pool;
  }

  /**
   * Create a TenantDatabase instance from a pg Pool
   * @example
   * ```typescript
   * import { Pool } from 'pg';
   * const pool = new Pool({ host: 'localhost', database: 'mydb' });
   * const tenantDb = TenantDatabase.fromPool(pool);
   * ```
   */
  static fromPool(pool: DatabasePool): TenantDatabase {
    return new TenantDatabase(pool);
  }

  /**
   * Execute a callback with tenant context set.
   * All queries within the callback are automatically scoped to the tenant.
   */
  async withTenant<T>(
    tenantId: string,
    callback: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT app.set_tenant_context($1)', [tenantId]);
      return await callback(client);
    } finally {
      client.release();
    }
  }

  /**
   * Execute a callback with tenant and user context.
   */
  async withTenantAndUser<T>(
    context: TenantContext,
    callback: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT app.set_tenant_context($1)', [context.tenantId]);

      if (context.userId) {
        await client.query('SELECT set_config($1, $2, true)', [
          'app.current_user_id',
          context.userId,
        ]);
      }

      return await callback(client);
    } finally {
      client.release();
    }
  }

  /**
   * Get a raw pool connection (without tenant context).
   * Use with caution — only for administrative operations.
   */
  async getRawConnection(): Promise<DatabaseClient> {
    return this.pool.connect();
  }

  /**
   * Close all connections in the pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ============================================================================
// Tenant Operations
// ============================================================================

export class TenantOperations {
  constructor(private db: TenantDatabase) {}

  /**
   * Create a new tenant.
   */
  async createTenant(data: {
    name: string;
    slug: string;
    plan?: string;
    settings?: Record<string, unknown>;
  }): Promise<Tenant> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 6: Pass Tenant as generic type argument so rows are typed correctly
      const result = await client.query<Tenant>(
        `INSERT INTO tenant.tenants (name, slug, plan, settings)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [data.name, data.slug, data.plan ?? 'free', JSON.stringify(data.settings ?? {})]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Get tenant by ID.
   */
  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.db.withTenant(tenantId, async (client) => {
      // FIX 7: Pass Tenant as generic type argument
      const result = await client.query<Tenant>('SELECT * FROM tenant.tenants WHERE id = $1', [
        tenantId,
      ]);
      return result.rows[0] ?? null;
    });
  }

  /**
   * Get tenant by slug.
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 8: Pass Tenant as generic type argument
      const result = await client.query<Tenant>('SELECT * FROM tenant.tenants WHERE slug = $1', [
        slug,
      ]);
      return result.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Update tenant settings.
   */
  async updateTenantSettings(tenantId: string, settings: Record<string, unknown>): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenant.tenants
         SET settings = settings || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify(settings), tenantId]
      );
    });
  }

  /**
   * Add user to tenant.
   */
  async addTenantMember(
    tenantId: string,
    userId: string,
    role: TenantMember['role'] = 'member'
  ): Promise<TenantMember> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 9: Pass TenantMember as generic type argument
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
  }

  /**
   * Get tenant members.
   */
  async getTenantMembers(tenantId: string): Promise<TenantMember[]> {
    return this.db.withTenant(tenantId, async (client) => {
      // FIX 10: Pass TenantMember as generic type argument
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
  }

  /**
   * Check if user is a member of tenant.
   */
  async isTenantMember(tenantId: string, userId: string): Promise<boolean> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 11: Use ExistsRow type so `.exists` is a known property (was `unknown`)
      const result = await client.query<ExistsRow>(
        `SELECT EXISTS(
           SELECT 1 FROM tenant.tenant_members
           WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
         ) AS exists`,
        [tenantId, userId]
      );
      return result.rows[0].exists;
    } finally {
      client.release();
    }
  }

  /**
   * Get user's role in tenant.
   */
  async getUserTenantRole(tenantId: string, userId: string): Promise<TenantMember['role'] | null> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 12: Use RoleRow — the original typed `{ role: TenantMember['role'] }`
      // inline generic was correct but inconsistently applied; normalised here
      const result = await client.query<RoleRow>(
        `SELECT role FROM tenant.tenant_members
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
        [tenantId, userId]
      );
      return result.rows[0]?.role ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Remove user from tenant.
   */
  async removeTenantMember(tenantId: string, userId: string): Promise<void> {
    const client = await this.db.getRawConnection();
    try {
      await client.query(
        `DELETE FROM tenant.tenant_members
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Invite user to tenant.
   */
  async inviteToTenant(
    tenantId: string,
    email: string,
    role: TenantMember['role'] = 'member',
    invitedBy: string
  ): Promise<string> {
    const client = await this.db.getRawConnection();
    try {
      // FIX 13: Use TokenRow so `.token` is a known property (was `unknown`)
      const result = await client.query<TokenRow>(
        `INSERT INTO tenant.tenant_invitations (tenant_id, email, role, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING token`,
        [tenantId, email, role, invitedBy]
      );
      return result.rows[0].token;
    } finally {
      client.release();
    }
  }
}

// ============================================================================
// User Operations
// ============================================================================

export class UserOperations {
  constructor(private db: TenantDatabase) {}

  /**
   * Create a new user.
   */
  async createUser(data: {
    tenantId: string;
    email: string;
    passwordHash?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<string> {
    return this.db.withTenant(data.tenantId, async (client) => {
      // FIX 14: Use IdRow so `.id` is a known property (was `unknown`)
      const result = await client.query<IdRow>(
        `INSERT INTO auth.users (tenant_id, email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [data.tenantId, data.email, data.passwordHash, data.firstName, data.lastName]
      );
      return result.rows[0].id;
    });
  }

  /**
   * Get user by email.
   */
  async getUserByEmail(tenantId: string, email: string): Promise<Record<string, unknown> | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query('SELECT * FROM auth.users WHERE email = $1', [email]);
      return result.rows[0] ?? null;
    });
  }

  /**
   * Get user by ID.
   */
  async getUserById(tenantId: string, userId: string): Promise<Record<string, unknown> | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query('SELECT * FROM auth.users WHERE id = $1', [userId]);
      return result.rows[0] ?? null;
    });
  }

  /**
   * Update user's last login.
   */
  async updateLastLogin(tenantId: string, userId: string, ipAddress?: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE auth.users
         SET last_login_at = NOW(),
             last_login_ip = $1,
             login_count = login_count + 1
         WHERE id = $2`,
        [ipAddress, userId]
      );
    });
  }

  /**
   * Verify user email.
   */
  async verifyEmail(tenantId: string, userId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE auth.users
         SET email_verified = TRUE,
             status = 'active'
         WHERE id = $1`,
        [userId]
      );
    });
  }

  /**
   * Get users by tenant.
   */
  async getUsersByTenant(tenantId: string): Promise<Record<string, unknown>[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, email, first_name, last_name, status,
                email_verified, created_at, last_login_at
         FROM auth.users
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC`
      );
      return result.rows;
    });
  }
}

// ============================================================================
// Express Middleware Factory
// ============================================================================

export interface AuthenticatedRequest {
  user?: {
    id: string;
    tenantId: string;
    email: string;
    role?: string;
  };
  db?: DatabaseClient;
  tenantId?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}

/**
 * Create Express middleware that sets tenant context.
 */
export function createTenantMiddleware(tenantDb: TenantDatabase) {
  // FIX 15: Replace `res: any, next: any` with typed Response / NextFunction
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const tenantId =
      req.user?.tenantId ??
      (req.headers['x-tenant-id'] as string | undefined) ??
      (req.query['tenant_id'] as string | undefined);

    if (!tenantId) {
      // FIX 16: `return` here was implicitly `any` due to `res: any`;
      // now it's explicitly `void` — call next() or respond and return.
      res.status(400).json({
        error: 'Tenant ID required',
        message: 'Provide tenant ID via x-tenant-id header or authenticated user',
      });
      return;
    }

    try {
      const client = await tenantDb.getRawConnection();
      await client.query('SELECT app.set_tenant_context($1)', [tenantId]);

      req.db = client;
      req.tenantId = tenantId;

      res.on('finish', () => {
        client.release();
      });

      next();
    } catch (error) {
      console.error('Error setting tenant context:', error);
      next(error);
    }
  };
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Execute a tenant-scoped query and return all rows.
 */
export async function tenantQuery<T = Record<string, unknown>>(
  client: DatabaseClient,
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await client.query<T>(query, params);
  return result.rows;
}

/**
 * Execute a tenant-scoped query and return a single row.
 */
export async function tenantQueryOne<T = Record<string, unknown>>(
  client: DatabaseClient,
  query: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await client.query<T>(query, params);
  // FIX 17: `|| null` → `?? null` to avoid falsy coercion on legitimate row values
  return result.rows[0] ?? null;
}

/**
 * Insert a row and return it.
 */
export async function tenantInsert<T = Record<string, unknown>>(
  client: DatabaseClient,
  table: string,
  data: Record<string, unknown>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  const query = `
    INSERT INTO ${table} (${columns})
    VALUES (${placeholders})
    RETURNING *
  `;

  const result = await client.query<T>(query, values);
  return result.rows[0];
}

/**
 * Update a row by ID and return the updated row.
 */
export async function tenantUpdate<T = Record<string, unknown>>(
  client: DatabaseClient,
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<T | null> {
  const keys = Object.keys(data);
  const values = Object.values(data);

  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');

  const query = `
    UPDATE ${table}
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await client.query<T>(query, [id, ...values]);
  // FIX 18: `|| null` → `?? null`
  return result.rows[0] ?? null;
}

/**
 * Soft-delete a row by ID.
 */
export async function tenantSoftDelete(
  client: DatabaseClient,
  table: string,
  id: string
): Promise<boolean> {
  const result = await client.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Export
// ============================================================================

export default {
  TenantDatabase,
  TenantOperations,
  UserOperations,
  createTenantMiddleware,
  tenantQuery,
  tenantQueryOne,
  tenantInsert,
  tenantUpdate,
  tenantSoftDelete,
};
