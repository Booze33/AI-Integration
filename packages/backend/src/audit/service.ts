/**
 * Audit Logging Service
 *
 * Comprehensive audit trail for all important operations.
 * Stores immutable records of user actions for compliance and debugging.
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export interface AuditEvent {
  id?: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  statusCode?: number;
  errorMessage?: string;
  timestamp?: Date;
}

export class AuditService {
  constructor(
    private pool: Pool,
    private retentionDays: number = 90
  ) {}

  /**
   * Initialize audit logging table
   */
  async ensureAuditTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app.audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        user_id UUID NOT NULL,
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(100) NOT NULL,
        resource_id UUID,
        changes JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status_code INTEGER,
        error_message TEXT,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON app.audit_logs(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON app.audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON app.audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON app.audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON app.audit_logs(resource);
    `);
  }

  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<void> {
    await this.ensureAuditTable();

    const id = event.id || randomUUID();
    const timestamp = event.timestamp || new Date();

    try {
      await this.pool.query(
        `INSERT INTO app.audit_logs (
          id, tenant_id, user_id, action, resource, resource_id,
          changes, ip_address, user_agent, status_code, error_message, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          event.tenantId,
          event.userId,
          event.action,
          event.resource,
          event.resourceId,
          event.changes ? JSON.stringify(event.changes) : null,
          event.ipAddress,
          event.userAgent,
          event.statusCode,
          event.errorMessage,
          timestamp,
        ]
      );
    } catch (error) {
      // Log error but don't throw - audit logging failures shouldn't break the application
      console.error('Audit logging failed:', error);
    }
  }

  /**
   * Get audit events for a specific user
   */
  async getUserEvents(
    tenantId: string,
    userId: string,
    limit: number = 100
  ): Promise<AuditEvent[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource,
              resource_id as "resourceId", changes, ip_address as "ipAddress",
              user_agent as "userAgent", status_code as "statusCode",
              error_message as "errorMessage", timestamp
       FROM app.audit_logs
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
      [tenantId, userId, limit]
    );

    return result.rows.map((row) => ({
      ...row,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
    }));
  }

  /**
   * Get audit events for a specific resource
   */
  async getResourceEvents(
    tenantId: string,
    resource: string,
    resourceId: string,
    limit: number = 50
  ): Promise<AuditEvent[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource,
              resource_id as "resourceId", changes, ip_address as "ipAddress",
              user_agent as "userAgent", status_code as "statusCode",
              error_message as "errorMessage", timestamp
       FROM app.audit_logs
       WHERE tenant_id = $1 AND resource = $2 AND resource_id = $3
       ORDER BY timestamp DESC
       LIMIT $4`,
      [tenantId, resource, resourceId, limit]
    );

    return result.rows.map((row) => ({
      ...row,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
    }));
  }

  /**
   * Get audit events for a specific action
   */
  async getActionEvents(
    tenantId: string,
    action: string,
    limit: number = 100
  ): Promise<AuditEvent[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource,
              resource_id as "resourceId", changes, ip_address as "ipAddress",
              user_agent as "userAgent", status_code as "statusCode",
              error_message as "errorMessage", timestamp
       FROM app.audit_logs
       WHERE tenant_id = $1 AND action = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
      [tenantId, action, limit]
    );

    return result.rows.map((row) => ({
      ...row,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
    }));
  }

  /**
   * Get all audit events for a tenant (for compliance/export)
   */
  async getTenantEvents(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 1000
  ): Promise<AuditEvent[]> {
    let query = `
      SELECT id, tenant_id as "tenantId", user_id as "userId", action, resource,
             resource_id as "resourceId", changes, ip_address as "ipAddress",
             user_agent as "userAgent", status_code as "statusCode",
             error_message as "errorMessage", timestamp
      FROM app.audit_logs
      WHERE tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (startDate) {
      query += ` AND timestamp >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND timestamp <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      ...row,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
    }));
  }

  /**
   * Delete audit logs older than retention policy
   */
  async cleanOldLogs(): Promise<number> {
    await this.ensureAuditTable();

    const result = await this.pool.query(
      `DELETE FROM app.audit_logs
       WHERE timestamp < NOW() - INTERVAL '${this.retentionDays} days'`
    );

    return result.rowCount ?? 0;
  }
}

/**
 * Middleware to extract IP address and user agent
 */
export function getClientInfo(req: any): { ipAddress: string; userAgent: string } {
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';

  return { ipAddress, userAgent };
}

export function createAuditService(pool: Pool, retentionDays: number = 90): AuditService {
  return new AuditService(pool, retentionDays);
}
