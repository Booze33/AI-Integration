/**
 * Tenant AI Configuration Service Unit Tests
 *
 * Tests for the tenant config service with encryption, validation, and CRUD operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantAIConfigService, InMemoryTenantAIConfigRepository } from '../tenant-config';
import { ProviderName } from '../types';

// Mock crypto functions
vi.mock('crypto', () => ({
  createCipheriv: vi.fn(() => ({
    update: vi.fn(() => 'encrypted'),
    final: vi.fn(() => 'final'),
  })),
  createDecipheriv: vi.fn(() => ({
    update: vi.fn(() => 'decrypted'),
    final: vi.fn(() => 'final'),
  })),
  randomBytes: vi.fn(() => Buffer.from('mock-iv')),
}));

describe('TenantAIConfigService', () => {
  let service: TenantAIConfigService;
  let repository: InMemoryTenantAIConfigRepository;
  const tenantId = 'test-tenant';
  const userId = 'test-user';

  beforeEach(() => {
    repository = new InMemoryTenantAIConfigRepository();
    service = new TenantAIConfigService('test-encryption-key', repository);
  });

  describe('Encryption', () => {
    it('should encrypt and decrypt API keys correctly', () => {
      const apiKey = 'sk-test123456789';
      const result = service.encryptApiKey(apiKey);

      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('iv');
      expect(typeof result.encrypted).toBe('string');
      expect(typeof result.iv).toBe('string');

      const decrypted = service.decryptApiKey(result.encrypted, result.iv);
      expect(decrypted).toBe(apiKey);
    });
  });

  describe('Validation', () => {
    it('should validate correct input', () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const errors = service.validateInput(input);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing provider', () => {
      const input = {
        provider: '' as ProviderName,
        api_key: 'sk-test123',
      };

      const errors = service.validateInput(input);
      expect(errors).toContain('Provider is required');
    });

    it('should reject missing API key', () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: '',
      };

      const errors = service.validateInput(input);
      expect(errors).toContain('API key is required');
    });

    it('should reject negative timeout', () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
        timeout_ms: -100,
      };

      const errors = service.validateInput(input);
      expect(errors).toContain('Timeout must be a positive number');
    });
  });

  describe('CRUD Operations', () => {
    const tenantId = 'tenant-123';
    const userId = 'user-456';

    it('should create a new configuration', async () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
        base_url: 'https://api.openai.com',
      };

      const config = await service.create(tenantId, input, userId);

      expect(config).toHaveProperty('id');
      expect(config.tenant_id).toBe(tenantId);
      expect(config.provider).toBe('openai');
      expect(config.is_active).toBe(true);
      expect(config.created_by).toBe(userId);
    });

    it('should find configuration by ID', async () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const created = await service.create(tenantId, input, userId);
      const found = await service.findById(created.id);

      expect(found).toEqual(created);
    });

    it('should find active configurations by tenant', async () => {
      const input1 = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const input2 = {
        provider: 'anthropic' as ProviderName,
        api_key: 'sk-anthropic123',
      };

      await service.create(tenantId, input1, userId);
      await service.create(tenantId, input2, userId);

      const configs = await service.findActiveByTenant(tenantId);

      expect(configs).toHaveLength(2);
      expect(configs.every((c) => c.tenant_id === tenantId)).toBe(true);
      expect(configs.every((c) => c.is_active)).toBe(true);
    });

    it('should update configuration', async () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const created = await service.create(tenantId, input, userId);

      const updates = {
        base_url: 'https://api.openai.com',
        timeout_ms: 30000,
      };

      const updated = await service.update(created.id, updates, userId);

      expect(updated.base_url).toBe('https://api.openai.com');
      expect(updated.timeout_ms).toBe(30000);
      expect(updated.updated_by).toBe(userId);
    });

    it('should deactivate configuration', async () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const created = await service.create(tenantId, input, userId);
      await service.deactivate(created.id, userId);

      const found = await service.findById(created.id);
      expect(found?.is_active).toBe(false);
    });

    it('should prevent duplicate providers per tenant', async () => {
      const input1 = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
      };

      const input2 = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test456',
      };

      await service.create(tenantId, input1, userId);

      await expect(service.create(tenantId, input2, userId)).rejects.toThrow(
        'Configuration already exists for provider: openai'
      );
    });
  });

  describe('Provider Config Conversion', () => {
    it('should convert tenant config to provider config', async () => {
      const input = {
        provider: 'openai' as ProviderName,
        api_key: 'sk-test123',
        base_url: 'https://api.openai.com',
        default_model: 'gpt-4',
        timeout: 30000,
      };

      const created = await service.create(tenantId, input, userId);
      const providerConfig = service.toProviderConfig(created);

      expect(providerConfig.apiKey).toBe('sk-test123'); // Would be decrypted in real scenario
      expect(providerConfig.baseUrl).toBe('https://api.openai.com');
      expect(providerConfig.defaultModel).toBe('gpt-4');
      expect(providerConfig.timeout).toBe(30000);
    });
  });
});
