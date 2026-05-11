/**
 * Migration: Audit Logs
 *
 * Adds app.audit_logs so audit logging exists immediately after migrations run.
 */

export const shorthands = undefined;

export async function up(pgm: any): Promise<void> {
  pgm.createTable(
    { schema: 'app', name: 'audit_logs' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: { type: 'uuid', notNull: true },
      user_id: { type: 'uuid', notNull: true },
      action: { type: 'varchar(100)', notNull: true },
      resource: { type: 'varchar(100)', notNull: true },
      resource_id: { type: 'uuid' },
      changes: { type: 'jsonb' },
      ip_address: { type: 'varchar(45)' },
      user_agent: { type: 'text' },
      status_code: { type: 'integer' },
      error_message: { type: 'text' },
      timestamp: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true }
  );

  pgm.createIndex({ schema: 'app', name: 'audit_logs' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'audit_logs' }, 'user_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'audit_logs' }, 'timestamp', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'audit_logs' }, 'action', { ifNotExists: true });
  pgm.createIndex({ schema: 'app', name: 'audit_logs' }, 'resource', { ifNotExists: true });
}

export async function down(pgm: any): Promise<void> {
  pgm.dropTable({ schema: 'app', name: 'audit_logs' }, { ifExists: true, cascade: true });
}
