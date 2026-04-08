/**
 * Migration: Tenant AI Configuration
 *
 * Adds per-tenant AI provider configuration with encrypted API keys
 */

export const shorthands = undefined;

export async function up(pgm: any): Promise<void> {
  // Tenant AI configurations table
  pgm.createTable(
    { schema: 'tenant', name: 'ai_configs' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenants' },
        onDelete: 'CASCADE',
      },
      provider: {
        type: 'varchar(50)',
        notNull: true,
        check:
          "provider IN ('openai', 'anthropic', 'deepgram', 'elevenlabs', 'azure-openai', 'google', 'mistral', 'groq', 'ollama', 'custom')",
      },
      api_key_encrypted: { type: 'text', notNull: true },
      api_key_iv: { type: 'text', notNull: true },
      base_url: { type: 'text' },
      organization: { type: 'varchar(255)' },
      default_model: { type: 'varchar(100)' },
      default_voice_id: { type: 'varchar(100)' },
      timeout_ms: { type: 'integer', notNull: true, default: 30000 },
      max_retries: { type: 'integer', notNull: true, default: 3 },
      is_active: { type: 'boolean', notNull: true, default: true },
      metadata: { type: 'jsonb', notNull: true, default: '{}' },
      created_by: { type: 'uuid', notNull: true },
      updated_by: { type: 'uuid' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      deleted_at: { type: 'timestamptz' },
    }
  );

  // Add unique constraint for active configs per provider per tenant
  pgm.addConstraint({ schema: 'tenant', name: 'ai_configs' }, 'tenant_ai_configs_unique_active', {
    unique: ['tenant_id', 'provider', 'is_active'],
    where: 'is_active = TRUE AND deleted_at IS NULL',
  });

  // Indexes
  pgm.createIndex({ schema: 'tenant', name: 'ai_configs' }, 'tenant_id', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'ai_configs' }, 'provider', { ifNotExists: true });
  pgm.createIndex({ schema: 'tenant', name: 'ai_configs' }, 'is_active', {
    ifNotExists: true,
    where: 'is_active = TRUE',
  });

  // Enable RLS
  pgm.sql('ALTER TABLE tenant.ai_configs ENABLE ROW LEVEL SECURITY');

  // RLS Policy
  pgm.sql(`CREATE POLICY ai_configs_isolation ON tenant.ai_configs
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)`);

  // Updated at trigger
  pgm.sql(`CREATE TRIGGER update_ai_configs_updated_at BEFORE UPDATE ON tenant.ai_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);

  // Comments
  pgm.sql(
    "COMMENT ON TABLE tenant.ai_configs IS 'Per-tenant AI provider configurations with encrypted API keys'"
  );
  pgm.sql("COMMENT ON COLUMN tenant.ai_configs.api_key_encrypted IS 'AES-256 encrypted API key'");
  pgm.sql(
    "COMMENT ON COLUMN tenant.ai_configs.api_key_iv IS 'Initialization vector for AES decryption'"
  );
}

export async function down(pgm: any): Promise<void> {
  // Drop table
  pgm.dropTable({ schema: 'tenant', name: 'ai_configs' }, { ifExists: true, cascade: true });
}
