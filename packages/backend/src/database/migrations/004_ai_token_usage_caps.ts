/**
 * Migration: AI Token Usage Caps
 *
 * Adds per-tenant configurable daily/monthly token caps,
 * raw usage events, and daily/monthly rollup tables.
 */

export const shorthands = undefined;

export async function up(pgm: any): Promise<void> {
  pgm.createTable(
    { schema: 'tenant', name: 'ai_token_caps' },
    {
      tenant_id: {
        type: 'uuid',
        primaryKey: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      daily_cap_tokens: { type: 'bigint' },
      monthly_cap_tokens: { type: 'bigint' },
      hard_cap_enabled: { type: 'boolean', notNull: true, default: true },
      created_by: { type: 'uuid', notNull: true },
      updated_by: { type: 'uuid' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  pgm.addConstraint({ schema: 'tenant', name: 'ai_token_caps' }, 'ai_token_caps_daily_positive', {
    check: 'daily_cap_tokens IS NULL OR daily_cap_tokens > 0',
  });

  pgm.addConstraint(
    { schema: 'tenant', name: 'ai_token_caps' },
    'ai_token_caps_monthly_positive',
    {
      check: 'monthly_cap_tokens IS NULL OR monthly_cap_tokens > 0',
    }
  );

  pgm.createTable(
    { schema: 'app', name: 'ai_token_usage_events' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      user_id: { type: 'uuid', notNull: true },
      route_source: { type: 'varchar(50)', notNull: true },
      provider: { type: 'varchar(50)' },
      model: { type: 'varchar(100)' },
      prompt_tokens: { type: 'integer', notNull: true, default: 0 },
      completion_tokens: { type: 'integer', notNull: true, default: 0 },
      total_tokens: { type: 'integer', notNull: true, default: 0 },
      is_estimated: { type: 'boolean', notNull: true, default: false },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  pgm.createIndex({ schema: 'app', name: 'ai_token_usage_events' }, ['tenant_id', 'created_at'], {
    ifNotExists: true,
    name: 'idx_ai_token_usage_events_tenant_created_at',
  });

  pgm.createTable(
    { schema: 'app', name: 'ai_token_usage_rollups_daily' },
    {
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      usage_date_utc: { type: 'date', notNull: true },
      total_tokens: { type: 'bigint', notNull: true, default: 0 },
      request_count: { type: 'integer', notNull: true, default: 0 },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  pgm.addConstraint(
    { schema: 'app', name: 'ai_token_usage_rollups_daily' },
    'ai_token_usage_rollups_daily_pk',
    {
      primaryKey: ['tenant_id', 'usage_date_utc'],
    }
  );

  pgm.createTable(
    { schema: 'app', name: 'ai_token_usage_rollups_monthly' },
    {
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      usage_month_utc: { type: 'date', notNull: true },
      total_tokens: { type: 'bigint', notNull: true, default: 0 },
      request_count: { type: 'integer', notNull: true, default: 0 },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    }
  );

  pgm.addConstraint(
    { schema: 'app', name: 'ai_token_usage_rollups_monthly' },
    'ai_token_usage_rollups_monthly_pk',
    {
      primaryKey: ['tenant_id', 'usage_month_utc'],
    }
  );

  pgm.sql(`CREATE TRIGGER update_ai_token_caps_updated_at
    BEFORE UPDATE ON tenant.ai_token_caps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);

  pgm.sql("COMMENT ON TABLE tenant.ai_token_caps IS 'Per-tenant AI token cap configuration' ");
  pgm.sql(
    "COMMENT ON TABLE app.ai_token_usage_events IS 'Raw AI token usage events for auditing and diagnostics'"
  );
  pgm.sql(
    "COMMENT ON TABLE app.ai_token_usage_rollups_daily IS 'Per-tenant daily AI token usage rollup (UTC day)'"
  );
  pgm.sql(
    "COMMENT ON TABLE app.ai_token_usage_rollups_monthly IS 'Per-tenant monthly AI token usage rollup (UTC month)'"
  );
}

export async function down(pgm: any): Promise<void> {
  pgm.dropTable({ schema: 'app', name: 'ai_token_usage_rollups_monthly' }, { ifExists: true });
  pgm.dropTable({ schema: 'app', name: 'ai_token_usage_rollups_daily' }, { ifExists: true });
  pgm.dropTable({ schema: 'app', name: 'ai_token_usage_events' }, { ifExists: true });
  pgm.dropTable({ schema: 'tenant', name: 'ai_token_caps' }, { ifExists: true });
}
