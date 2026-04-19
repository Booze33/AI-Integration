/**
 * Tenant AI Configuration API Integration Tests
 *
 * Tests for the tenant config API endpoints with full request/response cycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { tenantConfigRoutes, setTenantConfigService } from '../routes';
import { createTenantAIConfigService, InMemoryTenantAIConfigRepository } from '../tenant-config';

const mockAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAuditServiceLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Mock authentication middleware
vi.mock('../../auth/middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user', email: 'test@example.com', role: 'admin' };
    req.tenantId = 'test-tenant';
    next();
  },
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

vi.mock('../../audit', async () => {
  const actual = await vi.importActual<any>('../../audit');
  return {
    ...actual,
    logAudit: async (auditService: any, event: any) => {
      mockAuditLog(auditService, event);
      if (!auditService) {
        return;
      }

      try {
        await auditService.log({
          ...event,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('Failed to log audit event:', error);
      }
    },
  };
});

describe('Tenant Config API Routes', () => {
  let app: express.Application;
  let service: any;

  beforeEach(() => {
    // Create test service with in-memory repository
    const repository = new InMemoryTenantAIConfigRepository();
    service = createTenantAIConfigService('test-key', repository);
    setTenantConfigService(service);

    // Create test app
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auditService = { log: mockAuditServiceLog };
      req.clientInfo = { ipAddress: '203.0.113.5', userAgent: 'providers-route-test' };
      next();
    });
    mockAuditLog.mockClear();
    mockAuditServiceLog.mockClear();

    // Mock the service in the routes
    app.use('/api/tenant', tenantConfigRoutes);
  });

  describe('GET /api/tenant/config', () => {
    it('should return empty array when no configurations exist', async () => {
      const response = await request(app).get('/api/tenant/config').expect(200);

      expect(response.body).toEqual({
        success: true,
        data: [],
      });
    });

    it('should return configurations with masked API keys', async () => {
      // Create a test configuration
      await service.create(
        'test-tenant',
        {
          provider: 'openai',
          api_key: 'sk-test123',
        },
        'test-user'
      );

      const response = await request(app).get('/api/tenant/config').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].provider).toBe('openai');
      expect(response.body.data[0].api_key_encrypted).toBe('••••••••••••••••');
      expect(response.body.data[0].is_active).toBe(true);
    });

    it('returns all active configs for the current tenant', async () => {
      // Create two active configs for the current tenant
      await service.create(
        'test-tenant',
        { provider: 'openai', api_key: 'sk-active1' },
        'test-user'
      );
      await service.create(
        'test-tenant',
        { provider: 'anthropic', api_key: 'sk-active2' },
        'test-user'
      );

      // Create a config for a different tenant — should not appear
      await service.create(
        'other-tenant',
        { provider: 'openai', api_key: 'sk-other' },
        'test-user'
      );

      // Deactivate one of the current tenant's configs
      const allConfigs = await service.findActiveByTenant('test-tenant');
      await service.deactivate(allConfigs[0].id, 'test-user');

      const response = await request(app).get('/api/tenant/config').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tenant_id).toBe('test-tenant');
      expect(response.body.data[0].is_active).toBe(true);
    });
  });

  describe('POST /api/tenant/config', () => {
    it('creates a new config with an encrypted API key', async () => {
      const PLAINTEXT_KEY = 'sk-plaintext-key-to-encrypt-12345';

      const response = await request(app)
        .post('/api/tenant/config')
        .send({ provider: 'openai', api_key: PLAINTEXT_KEY })
        .expect(201);

      expect(response.body.success).toBe(true);

      // Response must not expose the plaintext key
      expect(JSON.stringify(response.body)).not.toContain(PLAINTEXT_KEY);

      // Retrieve stored record directly from service to inspect raw storage
      const stored = await service.findActiveByTenant('test-tenant');
      expect(stored).toHaveLength(1);

      // Stored value must differ from plaintext — it is ciphertext
      expect(stored[0].api_key_encrypted).not.toBe(PLAINTEXT_KEY);
      expect(stored[0].api_key_encrypted).toBeTruthy();
      expect(stored[0].api_key_iv).toBeTruthy();

      // Service must be able to decrypt it back to the original key
      const decrypted = service.decryptApiKey(stored[0].api_key_encrypted, stored[0].api_key_iv);
      expect(decrypted).toBe(PLAINTEXT_KEY);
    });

    it('should create a new configuration', async () => {
      const configData = {
        provider: 'openai',
        api_key: 'sk-test123456789',
        base_url: 'https://api.openai.com',
        default_model: 'gpt-4',
      };

      const response = await request(app).post('/api/tenant/config').send(configData).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.provider).toBe('openai');
      expect(response.body.data.api_key_encrypted).toBe('••••••••••••••••');
      expect(response.body.data.base_url).toBe('https://api.openai.com');
      expect(response.body.data.default_model).toBe('gpt-4');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'CREATE_CONFIG',
          resource: 'TENANT_AI_CONFIG',
          ipAddress: '203.0.113.5',
          userAgent: 'providers-route-test',
          statusCode: 201,
        })
      );
    });

    it('continues the request when audit logging fails', async () => {
      mockAuditServiceLog.mockRejectedValueOnce(new Error('audit write failed'));

      const response = await request(app)
        .post('/api/tenant/config')
        .send({ provider: 'openai', api_key: 'sk-audit-failure' })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should validate required fields', async () => {
      const response = await request(app).post('/api/tenant/config').send({}).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it('should prevent duplicate providers', async () => {
      // Create first config
      await service.create(
        'test-tenant',
        {
          provider: 'openai',
          api_key: 'sk-test123',
        },
        'test-user'
      );

      // Try to create duplicate
      const response = await request(app)
        .post('/api/tenant/config')
        .send({
          provider: 'openai',
          api_key: 'sk-test456',
        })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
    });

    it('creating a second config for the same provider returns 409', async () => {
      const configData = { provider: 'anthropic', api_key: 'sk-first-key' };

      await request(app).post('/api/tenant/config').send(configData).expect(201);

      const response = await request(app)
        .post('/api/tenant/config')
        .send({ provider: 'anthropic', api_key: 'sk-second-key' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');

      // Only one config should exist for this tenant
      const configs = await service.findActiveByTenant('test-tenant');
      const anthropicConfigs = configs.filter((c: any) => c.provider === 'anthropic');
      expect(anthropicConfigs).toHaveLength(1);
    });
  });

  describe('GET /api/tenant/config/:id', () => {
    it('should return specific configuration', async () => {
      const created = await service.create(
        'test-tenant',
        {
          provider: 'openai',
          api_key: 'sk-test123',
        },
        'test-user'
      );

      const response = await request(app).get(`/api/tenant/config/${created.id}`).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(created.id);
      expect(response.body.data.provider).toBe('openai');
    });

    it('should return 404 for non-existent configuration', async () => {
      const response = await request(app)
        .get('/api/tenant/config/11111111-1111-4111-8111-111111111111')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Configuration not found');
    });
  });

  describe('PUT /api/tenant/config/:id', () => {
    it('should update configuration', async () => {
      const created = await service.create(
        'test-tenant',
        {
          provider: 'openai',
          api_key: 'sk-test123',
        },
        'test-user'
      );

      const updates = {
        base_url: 'https://api.openai.com',
        timeout_ms: 30000,
      };

      const response = await request(app)
        .put(`/api/tenant/config/${created.id}`)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.base_url).toBe('https://api.openai.com');
      expect(response.body.data.timeout_ms).toBe(30000);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'UPDATE_CONFIG',
          resource: 'TENANT_AI_CONFIG',
          resourceId: created.id,
          statusCode: 200,
        })
      );
    });

    it('should return 404 for non-existent configuration', async () => {
      const response = await request(app)
        .put('/api/tenant/config/11111111-1111-4111-8111-111111111111')
        .send({ base_url: 'https://example.com' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('updates a config — if API key is provided, it is re-encrypted', async () => {
      const ORIGINAL_KEY = 'sk-original-key-111';
      const NEW_KEY = 'sk-new-key-222';

      const created = await service.create(
        'test-tenant',
        { provider: 'openai', api_key: ORIGINAL_KEY },
        'test-user'
      );

      const originalEncrypted = created.api_key_encrypted;
      const originalIv = created.api_key_iv;

      // PUT with a new API key
      const response = await request(app)
        .put(`/api/tenant/config/${created.id}`)
        .send({ api_key: NEW_KEY })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Response must mask the key
      expect(JSON.stringify(response.body)).not.toContain(NEW_KEY);
      expect(JSON.stringify(response.body)).not.toContain(ORIGINAL_KEY);
      expect(response.body.data.api_key_encrypted).toBe('••••••••••••••••');

      // Stored record must have a new ciphertext
      const updated = await service.findById(created.id);
      expect(updated!.api_key_encrypted).not.toBe(originalEncrypted);
      expect(updated!.api_key_encrypted).not.toBe(NEW_KEY);
      expect(updated!.api_key_iv).not.toBe(originalIv); // fresh IV each encryption

      // Decryption roundtrip confirms the new key was stored correctly
      const decrypted = service.decryptApiKey(updated!.api_key_encrypted, updated!.api_key_iv);
      expect(decrypted).toBe(NEW_KEY);
    });
  });

  describe('DELETE /api/tenant/config/:id', () => {
    it('should deactivate configuration', async () => {
      const created = await service.create(
        'test-tenant',
        {
          provider: 'openai',
          api_key: 'sk-test123',
        },
        'test-user'
      );

      const response = await request(app).delete(`/api/tenant/config/${created.id}`).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deactivated');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'DEACTIVATE_CONFIG',
          resource: 'TENANT_AI_CONFIG',
          resourceId: created.id,
          statusCode: 200,
        })
      );

      // Verify it's deactivated
      const found = await service.findById(created.id);
      expect(found?.is_active).toBe(false);
    });

    it('deactivates the config (soft delete), not hard delete', async () => {
      const created = await service.create(
        'test-tenant',
        { provider: 'openai', api_key: 'sk-soft-delete-test' },
        'test-user'
      );

      await request(app).delete(`/api/tenant/config/${created.id}`).expect(200);

      // Record must still exist in storage — not hard deleted
      const record = await service.findById(created.id);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(created.id);

      // But it must be marked inactive
      expect(record!.is_active).toBe(false);

      // And it must no longer appear in the active configs list
      const activeConfigs = await service.findActiveByTenant('test-tenant');
      const stillActive = activeConfigs.find((c) => c.id === created.id);
      expect(stillActive).toBeUndefined();
    });
  });

  describe('Tenant isolation', () => {
    it("a tenant admin cannot read or modify another tenant's configs", async () => {
      // Create a config owned by a different tenant directly via the service
      const otherConfig = await service.create(
        'other-tenant',
        { provider: 'openai', api_key: 'sk-other-tenant-secret' },
        'other-user'
      );

      // GET list: authenticated as test-tenant — must not see other-tenant's config
      const listResponse = await request(app).get('/api/tenant/config').expect(200);
      const ids = listResponse.body.data.map((c: any) => c.id);
      expect(ids).not.toContain(otherConfig.id);

      // GET /:id: must return 404, not the other tenant's data
      await request(app).get(`/api/tenant/config/${otherConfig.id}`).expect(404);

      // PUT /:id: must return 404, not update the other tenant's config
      await request(app)
        .put(`/api/tenant/config/${otherConfig.id}`)
        .send({ default_model: 'gpt-4o' })
        .expect(404);

      // DELETE /:id: must return 404, not deactivate the other tenant's config
      await request(app).delete(`/api/tenant/config/${otherConfig.id}`).expect(404);

      // Confirm the other tenant's config is untouched
      const untouched = await service.findById(otherConfig.id);
      expect(untouched).not.toBeNull();
      expect(untouched!.is_active).toBe(true);
      expect(untouched!.default_model).toBeUndefined();
    });
  });

  describe('GET /api/tenant/providers', () => {
    it('should return list of available providers', async () => {
      const response = await request(app).get('/api/tenant/providers').expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const openaiProvider = response.body.data.find((p: any) => p.name === 'openai');
      expect(openaiProvider).toBeDefined();
      expect(openaiProvider.displayName).toBe('OpenAI');
      expect(openaiProvider.requiresApiKey).toBe(true);
    });

    it('returns the full list of supported providers', async () => {
      const response = await request(app).get('/api/tenant/providers').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([
        { name: 'openai', displayName: 'OpenAI', requiresApiKey: true },
        { name: 'anthropic', displayName: 'Anthropic', requiresApiKey: true },
        { name: 'deepgram', displayName: 'Deepgram', requiresApiKey: true },
        { name: 'elevenlabs', displayName: 'ElevenLabs', requiresApiKey: true },
        { name: 'azure-openai', displayName: 'Azure OpenAI', requiresApiKey: true },
        { name: 'google', displayName: 'Google AI', requiresApiKey: true },
        { name: 'mistral', displayName: 'Mistral AI', requiresApiKey: true },
        { name: 'groq', displayName: 'Groq', requiresApiKey: true },
        { name: 'ollama', displayName: 'Ollama', requiresApiKey: false },
        { name: 'custom', displayName: 'Custom Provider', requiresApiKey: true },
      ]);
    });
  });

  describe('API key masking across all endpoints', () => {
    const PLAINTEXT_KEY = 'sk-super-secret-plaintext-9999';
    const MASK = '••••••••••••••••';

    function assertKeyNotLeaked(body: unknown) {
      const json = JSON.stringify(body);
      expect(json).not.toContain(PLAINTEXT_KEY);
      expect(json).toContain(MASK);
    }

    it('API keys are masked as •••••••••••••••• in every response — the plaintext key is never returned', async () => {
      // POST /api/tenant/config — create response must mask the key
      const createResponse = await request(app)
        .post('/api/tenant/config')
        .send({ provider: 'openai', api_key: PLAINTEXT_KEY })
        .expect(201);

      assertKeyNotLeaked(createResponse.body);

      // GET /api/tenant/config — list response must mask the key
      const listResponse = await request(app).get('/api/tenant/config').expect(200);
      assertKeyNotLeaked(listResponse.body);
    });
  });
});
