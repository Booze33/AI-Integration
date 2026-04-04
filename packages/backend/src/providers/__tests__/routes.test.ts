/**
 * Tenant AI Configuration API Integration Tests
 *
 * Tests for the tenant config API endpoints with full request/response cycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { tenantConfigRoutes } from '../routes';
import { createTenantAIConfigService, InMemoryTenantAIConfigRepository } from '../tenant-config';

// Mock authentication middleware
vi.mock('../../auth/middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user', email: 'test@example.com', role: 'admin' };
    req.tenantId = 'test-tenant';
    next();
  },
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

describe('Tenant Config API Routes', () => {
  let app: express.Application;
  let service: any;

  beforeEach(() => {
    // Create test service with in-memory repository
    const repository = new InMemoryTenantAIConfigRepository();
    service = createTenantAIConfigService('test-key', repository);

    // Create test app
    app = express();
    app.use(express.json());

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
  });

  describe('POST /api/tenant/config', () => {
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
      const response = await request(app).get('/api/tenant/config/non-existent-id').expect(404);

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
    });

    it('should return 404 for non-existent configuration', async () => {
      const response = await request(app)
        .put('/api/tenant/config/non-existent-id')
        .send({ base_url: 'https://example.com' })
        .expect(404);

      expect(response.body.success).toBe(false);
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

      // Verify it's deactivated
      const found = await service.findById(created.id);
      expect(found?.is_active).toBe(false);
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
  });
});
