-- ============================================================================
-- Migration: Tenant AI Configuration
-- ============================================================================
-- Adds per-tenant AI provider configuration with encrypted API keys
-- ============================================================================

-- Tenant AI configurations table
CREATE TABLE tenant.ai_configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenant.tenants(id) ON DELETE CASCADE,
    provider        VARCHAR(50) NOT NULL CHECK (provider IN ('openai', 'anthropic', 'deepgram', 'elevenlabs', 'azure-openai', 'google', 'mistral', 'groq', 'ollama', 'custom')),
    api_key_encrypted TEXT NOT NULL,  -- Encrypted API key using pgcrypto
    api_key_iv      TEXT NOT NULL,     -- Initialization vector for decryption
    base_url        TEXT,
    organization    VARCHAR(255),
    default_model  VARCHAR(100),
    default_voice_id VARCHAR(100),    -- For ElevenLabs
    timeout_ms      INTEGER DEFAULT 30000,
    max_retries     INTEGER DEFAULT 3,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_by      UUID NOT NULL,
    updated_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    
    -- Only one active config per provider per tenant
    CONSTRAINT tenant_ai_configs_unique_active UNIQUE (tenant_id, provider, is_active) 
        WHERE (is_active = TRUE AND deleted_at IS NULL)
);

CREATE INDEX idx_ai_configs_tenant_id ON tenant.ai_configs(tenant_id);
CREATE INDEX idx_ai_configs_provider ON tenant.ai_configs(provider);
CREATE INDEX idx_ai_configs_active ON tenant.ai_configs(is_active) WHERE is_active = TRUE;

-- Enable RLS
ALTER TABLE tenant.ai_configs ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY ai_configs_isolation ON tenant.ai_configs
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Updated at trigger
CREATE TRIGGER update_ai_configs_updated_at BEFORE UPDATE ON tenant.ai_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE tenant.ai_configs IS 'Per-tenant AI provider configurations with encrypted API keys';
COMMENT ON COLUMN tenant.ai_configs.api_key_encrypted IS 'AES-256 encrypted API key';
COMMENT ON COLUMN tenant.ai_configs.api_key_iv IS 'Initialization vector for AES decryption';