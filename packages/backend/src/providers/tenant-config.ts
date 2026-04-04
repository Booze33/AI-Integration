/**
 * Tenant AI Configuration Service
 *
 * Manages per-tenant AI provider configurations with encrypted API keys.
 * Supports multiple providers per tenant with one active at a time.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ProviderName, ProviderConfig } from './types';

/**
 * Tenant AI configuration from database
 */
export interface TenantAIConfig {
  id: string;
  tenant_id: string;
  provider: ProviderName;
  api_key_encrypted: string;
  api_key_iv: string;
  base_url?: string;
  organization?: string;
  default_model?: string;
  default_voice_id?: string;
  timeout_ms?: number;
  max_retries?: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating/updating tenant AI config
 */
export interface TenantAIConfigInput {
  provider: ProviderName;
  api_key: string;
  base_url?: string;
  organization?: string;
  default_model?: string;
  default_voice_id?: string;
  timeout_ms?: number;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Encryption configuration
 */
interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
}

/**
 * Tenant AI Configuration Service
 */
export class TenantAIConfigService {
  private readonly encryptionKey: Buffer;
  private readonly encryptionConfig: EncryptionConfig = {
    algorithm: 'aes-256-cbc',
    keyLength: 32,
    ivLength: 16,
  };
  private readonly repository: TenantAIConfigRepository;

  constructor(encryptionKey: string, repository: TenantAIConfigRepository) {
    // Ensure key is exactly 32 bytes for AES-256
    this.encryptionKey = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32), 'utf8');
    this.repository = repository;
  }

  /**
   * Encrypt an API key
   */
  encryptApiKey(apiKey: string): { encrypted: string; iv: string } {
    const iv = randomBytes(this.encryptionConfig.ivLength);
    const cipher = createCipheriv(this.encryptionConfig.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
    };
  }

  /**
   * Decrypt an API key
   */
  decryptApiKey(encrypted: string, iv: string): string {
    const decipher = createDecipheriv(
      this.encryptionConfig.algorithm,
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Convert tenant config to provider config
   */
  toProviderConfig(config: TenantAIConfig): ProviderConfig {
    return {
      apiKey: this.decryptApiKey(config.api_key_encrypted, config.api_key_iv),
      baseUrl: config.base_url,
      organization: config.organization,
      defaultModel: config.default_model,
      timeout: config.timeout_ms,
      maxRetries: config.max_retries,
    };
  }

  /**
   * Validate tenant config input
   */
  validateInput(input: TenantAIConfigInput): string[] {
    const errors: string[] = [];

    if (!input.provider) {
      errors.push('Provider is required');
    }

    if (!input.api_key) {
      errors.push('API key is required');
    }

    if (input.timeout_ms !== undefined && input.timeout_ms < 0) {
      errors.push('Timeout must be a positive number');
    }

    if (input.max_retries !== undefined && input.max_retries < 0) {
      errors.push('Max retries must be a positive number');
    }

    return errors;
  }

  /**
   * Find configuration by ID
   */
  async findById(id: string): Promise<TenantAIConfig | null> {
    return this.repository.findById(id);
  }

  /**
   * Find configuration by tenant and provider
   */
  async findByTenantAndProvider(
    tenantId: string,
    provider: ProviderName
  ): Promise<TenantAIConfig | null> {
    return this.repository.findByTenantAndProvider(tenantId, provider);
  }

  /**
   * Find all active configurations for a tenant
   */
  async findActiveByTenant(tenantId: string): Promise<TenantAIConfig[]> {
    return this.repository.findActiveByTenant(tenantId);
  }

  /**
   * Create a new tenant AI configuration
   */
  async create(
    tenantId: string,
    input: TenantAIConfigInput,
    createdBy: string
  ): Promise<TenantAIConfig> {
    // Validate input
    const errors = this.validateInput(input);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }

    // Encrypt the API key
    const { encrypted } = this.encryptApiKey(input.api_key);

    // Create the configuration with encrypted data
    const configInput = {
      ...input,
      api_key: encrypted, // This will be stored as api_key_encrypted
    };

    return this.repository.create(tenantId, configInput, createdBy);
  }

  /**
   * Update an existing tenant AI configuration
   */
  async update(
    id: string,
    input: Partial<TenantAIConfigInput>,
    updatedBy: string
  ): Promise<TenantAIConfig> {
    // If API key is being updated, encrypt it
    let configInput = input;
    if (input.api_key) {
      const { encrypted } = this.encryptApiKey(input.api_key);
      configInput = {
        ...input,
        api_key: encrypted,
      };
    }

    return this.repository.update(id, configInput, updatedBy);
  }

  /**
   * Deactivate a tenant AI configuration
   */
  async deactivate(id: string, updatedBy: string): Promise<void> {
    return this.repository.deactivate(id, updatedBy);
  }

  /**
   * Delete a tenant AI configuration
   */
  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }
}

/**
 * Database operations interface (to be implemented with actual DB client)
 */
export interface TenantAIConfigRepository {
  findById(id: string): Promise<TenantAIConfig | null>;
  findByTenantAndProvider(tenantId: string, provider: ProviderName): Promise<TenantAIConfig | null>;
  findActiveByTenant(tenantId: string): Promise<TenantAIConfig[]>;
  create(tenantId: string, input: TenantAIConfigInput, createdBy: string): Promise<TenantAIConfig>;
  update(
    id: string,
    input: Partial<TenantAIConfigInput>,
    updatedBy: string
  ): Promise<TenantAIConfig>;
  deactivate(id: string, updatedBy: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * In-memory repository for testing (replace with actual DB implementation)
 */
export class InMemoryTenantAIConfigRepository implements TenantAIConfigRepository {
  private configs: Map<string, TenantAIConfig> = new Map();
  private idCounter = 0;

  async findById(id: string): Promise<TenantAIConfig | null> {
    return this.configs.get(id) || null;
  }

  async findByTenantAndProvider(
    tenantId: string,
    provider: ProviderName
  ): Promise<TenantAIConfig | null> {
    for (const config of this.configs.values()) {
      if (config.tenant_id === tenantId && config.provider === provider && config.is_active) {
        return config;
      }
    }
    return null;
  }

  async findActiveByTenant(tenantId: string): Promise<TenantAIConfig[]> {
    const result: TenantAIConfig[] = [];
    for (const config of this.configs.values()) {
      if (config.tenant_id === tenantId && config.is_active) {
        result.push(config);
      }
    }
    return result;
  }

  async create(
    tenantId: string,
    input: TenantAIConfigInput,
    createdBy: string
  ): Promise<TenantAIConfig> {
    const id = `config-${++this.idCounter}`;
    const now = new Date();

    // For in-memory implementation, we'll store the API key as-is
    // In a real implementation, this would already be encrypted by the service
    const config: TenantAIConfig = {
      id,
      tenant_id: tenantId,
      provider: input.provider,
      api_key_encrypted: input.api_key, // In real impl this would be encrypted
      api_key_iv: 'dummy-iv', // In real impl this would be generated
      base_url: input.base_url,
      organization: input.organization,
      default_model: input.default_model,
      default_voice_id: input.default_voice_id,
      timeout_ms: input.timeout_ms,
      max_retries: input.max_retries,
      is_active: true,
      metadata: input.metadata || {},
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    };

    this.configs.set(id, config);
    return config;
  }

  async update(
    id: string,
    input: Partial<TenantAIConfigInput>,
    updatedBy: string
  ): Promise<TenantAIConfig> {
    const config = this.configs.get(id);
    if (!config) {
      throw new Error(`Config not found: ${id}`);
    }

    const updated: TenantAIConfig = {
      ...config,
      ...input,
      updated_by: updatedBy,
      updated_at: new Date(),
    };

    this.configs.set(id, updated);
    return updated;
  }

  async deactivate(id: string, updatedBy: string): Promise<void> {
    const config = this.configs.get(id);
    if (config) {
      config.is_active = false;
      config.updated_by = updatedBy;
      config.updated_at = new Date();
    }
  }

  async delete(id: string): Promise<void> {
    this.configs.delete(id);
  }
}

/**
 * Factory function to create tenant config service
 */
export function createTenantAIConfigService(
  encryptionKey: string,
  repository?: TenantAIConfigRepository
): TenantAIConfigService {
  const repo = repository || new InMemoryTenantAIConfigRepository();
  return new TenantAIConfigService(encryptionKey, repo);
}
