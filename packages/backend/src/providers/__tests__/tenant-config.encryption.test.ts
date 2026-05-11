import { describe, it, expect } from 'vitest';
import { TenantAIConfigService, InMemoryTenantAIConfigRepository } from '../tenant-config';
import { ProviderName } from '../types';

describe('TenantAIConfig encryption behavior', () => {
  const tenantId = 'tenant-encryption-test';
  const userId = 'user-encryption-test';
  const encryptionKey = '12345678901234567890123456789012';

  it('stores ciphertext in api_key_encrypted, not plaintext', async () => {
    const repository = new InMemoryTenantAIConfigRepository();
    const service = new TenantAIConfigService(encryptionKey, repository);
    const plaintext = 'sk-plaintext-123';

    const created = await service.create(
      tenantId,
      { provider: 'openai' as ProviderName, api_key: plaintext },
      userId
    );

    expect(created.api_key_encrypted).not.toBe(plaintext);
    expect(created.api_key_encrypted).toMatch(/^[0-9a-f]+$/i);
  });

  it('populates api_key_iv and generates a unique IV per record', async () => {
    const repository = new InMemoryTenantAIConfigRepository();
    const service = new TenantAIConfigService(encryptionKey, repository);

    const first = await service.create(
      tenantId,
      { provider: 'openai' as ProviderName, api_key: 'sk-first' },
      userId
    );

    const second = await service.create(
      tenantId,
      { provider: 'anthropic' as ProviderName, api_key: 'sk-second' },
      userId
    );

    expect(first.api_key_iv).toBeTruthy();
    expect(second.api_key_iv).toBeTruthy();
    expect(first.api_key_iv).toMatch(/^[0-9a-f]{32}$/i);
    expect(second.api_key_iv).toMatch(/^[0-9a-f]{32}$/i);
    expect(first.api_key_iv).not.toBe(second.api_key_iv);
  });

  it('decrypts a stored key with the correct TENANT_CONFIG_ENCRYPTION_KEY', async () => {
    const repository = new InMemoryTenantAIConfigRepository();
    const service = new TenantAIConfigService(encryptionKey, repository);
    const plaintext = 'sk-original-key-abc';

    const created = await service.create(
      tenantId,
      { provider: 'openai' as ProviderName, api_key: plaintext },
      userId
    );

    const decrypted = service.decryptApiKey(created.api_key_encrypted, created.api_key_iv);
    expect(decrypted).toBe(plaintext);
  });

  it('makes existing configs unreadable if TENANT_CONFIG_ENCRYPTION_KEY changes', async () => {
    const repository = new InMemoryTenantAIConfigRepository();
    const originalService = new TenantAIConfigService(encryptionKey, repository);
    const rotatedService = new TenantAIConfigService(
      'abcdefghijklmnopqrstuvwxyz123456',
      repository
    );

    const created = await originalService.create(
      tenantId,
      { provider: 'openai' as ProviderName, api_key: 'sk-before-rotation' },
      userId
    );

    expect(() =>
      rotatedService.decryptApiKey(created.api_key_encrypted, created.api_key_iv)
    ).toThrow();
  });
});
