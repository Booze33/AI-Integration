import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import {
  authenticate,
  requireTenant,
  requireRole,
  requireMinRole,
  authenticateWithTenant,
  Role,
  AuthenticatedRequest,
} from '../middleware';
import { generateTokenPair, TokenPayload } from '../jwt';

// Test app setup
let app: express.Application;
let privateKey: string;

beforeAll(() => {
  // Load keys for testing
  const keysDir = path.join(__dirname, '../../../keys');
  privateKey = fs.readFileSync(path.join(keysDir, 'private.pem'), 'utf8');

  // Create test app
  app = express();
  app.use(express.json());

  // Test routes
  app.post('/auth/login', (req: express.Request, res: express.Response) => {
    const { email, password, role, tenantId } = req.body;

    // Simple test authentication
    if (email === 'test@example.com' && password === 'password123') {
      const payload: TokenPayload = {
        userId: 'user-123',
        email,
        role: role || 'viewer',
        tenantId: tenantId || 'tenant-456',
      };

      const tokens = generateTokenPair(payload);

      res.json({
        message: 'Login successful',
        user: { id: payload.userId, email: payload.email, role: payload.role },
        ...tokens,
      });
    } else {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
  });

  app.post('/auth/login-admin', (req: express.Request, res: express.Response) => {
    const { email, password, tenantId } = req.body;

    if (email === 'admin@example.com' && password === 'admin123') {
      const payload: TokenPayload = {
        userId: 'admin-123',
        email,
        role: 'admin',
        tenantId: tenantId || 'tenant-456',
      };

      const tokens = generateTokenPair(payload);

      res.json({
        message: 'Login successful',
        user: { id: payload.userId, email: payload.email, role: payload.role },
        ...tokens,
      });
    } else {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
  });

  // Protected routes for testing
  app.get('/protected', authenticate, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  app.get('/tenant-required', authenticate, requireTenant(), (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user, tenantId: req.tenantId });
  });

  app.get(
    '/admin-only',
    authenticate,
    requireRole(Role.ADMIN),
    (req: AuthenticatedRequest, res) => {
      res.json({ message: 'Admin access granted', user: req.user });
    }
  );

  app.get(
    '/member-plus',
    authenticate,
    requireMinRole(Role.MEMBER),
    (req: AuthenticatedRequest, res) => {
      res.json({ message: 'Member+ access granted', user: req.user });
    }
  );

  app.get('/combined', ...authenticateWithTenant(), (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user, tenantId: req.tenantId });
  });
});

describe('Auth Integration Tests', () => {
  // ========================================================================
  // 1. VALID LOGIN
  // ========================================================================
  describe('Valid Login', () => {
    it('should return tokens for valid credentials', async () => {
      const response = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'member',
        tenantId: 'tenant-456',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.user.role).toBe('member');
    });

    it('should access protected route with valid token', async () => {
      // First login
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'viewer',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      // Access protected route
      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.user.tenantId).toBe('tenant-456');
    });

    it('should access tenant-required route with token containing tenantId', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'viewer',
        tenantId: 'tenant-789',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/tenant-required')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.tenantId).toBe('tenant-789');
      expect(response.body.user.tenantId).toBe('tenant-789');
    });
  });

  // ========================================================================
  // 2. EXPIRED TOKEN
  // ========================================================================
  describe('Expired Token', () => {
    it('should reject expired access token', async () => {
      // Create an expired token manually
      const expiredPayload: TokenPayload = {
        userId: 'user-123',
        email: 'expired@example.com',
        role: 'viewer',
        tenantId: 'tenant-456',
      };

      const expiredToken = jwt.sign(expiredPayload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '-1s', // Already expired
        issuer: 'ai-initializer',
        audience: 'ai-initializer-client',
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject token with invalid signature', async () => {
      // Create a token with wrong secret
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'invalid@example.com',
        role: 'viewer',
        tenantId: 'tenant-456',
      };

      const invalidToken = jwt.sign(payload, 'wrong-secret-key', {
        algorithm: 'HS256', // Wrong algorithm
        expiresIn: '15m',
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject token with wrong issuer', async () => {
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'wrong-issuer@example.com',
        role: 'viewer',
        tenantId: 'tenant-456',
      };

      const wrongIssuerToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'wrong-issuer', // Wrong issuer
        audience: 'ai-initializer-client',
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${wrongIssuerToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ========================================================================
  // 3. WRONG ROLE
  // ========================================================================
  describe('Wrong Role', () => {
    it('should deny viewer access to admin-only route', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'viewer',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toContain('Required role: admin');
    });

    it('should deny member access to admin-only route', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'member',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should deny viewer access to member-plus route', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'viewer',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/member-plus')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toContain('Requires member role or higher');
    });

    it('should allow admin access to admin-only route', async () => {
      const loginRes = await request(app).post('/auth/login-admin').send({
        email: 'admin@example.com',
        password: 'admin123',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Admin access granted');
    });

    it('should allow admin access to member-plus route (hierarchy)', async () => {
      const loginRes = await request(app).post('/auth/login-admin').send({
        email: 'admin@example.com',
        password: 'admin123',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/member-plus')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Member+ access granted');
    });

    it('should allow member access to member-plus route', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
        role: 'member',
        tenantId: 'tenant-456',
      });

      const { accessToken } = loginRes.body;

      const response = await request(app)
        .get('/member-plus')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Member+ access granted');
    });
  });

  // ========================================================================
  // 4. MISSING TENANT
  // ========================================================================
  describe('Missing Tenant', () => {
    it('should reject request to tenant-required route when tenantId is missing', async () => {
      // Create token without tenantId
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'no-tenant@example.com',
        role: 'viewer',
        // No tenantId
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'ai-initializer',
        audience: 'ai-initializer-client',
      });

      const response = await request(app)
        .get('/tenant-required')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Tenant ID required');
    });

    it('should allow tenant from header when JWT has no tenantId', async () => {
      // Create token without tenantId
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'header-tenant@example.com',
        role: 'viewer',
        // No tenantId in JWT
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'ai-initializer',
        audience: 'ai-initializer-client',
      });

      const response = await request(app)
        .get('/tenant-required')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'tenant-from-header');

      expect(response.status).toBe(200);
      expect(response.body.tenantId).toBe('tenant-from-header');
    });

    it('should reject combined middleware without tenant', async () => {
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'combined-no-tenant@example.com',
        role: 'viewer',
        // No tenantId
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'ai-initializer',
        audience: 'ai-initializer-client',
      });

      const response = await request(app).get('/combined').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('should reject request without any authentication', async () => {
      const response = await request(app).get('/tenant-required');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ========================================================================
  // ADDITIONAL EDGE CASES
  // ========================================================================
  describe('Edge Cases', () => {
    it('should reject malformed authorization header', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'InvalidFormat token123');

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid authorization header format');
    });

    it('should reject empty authorization header', async () => {
      const response = await request(app).get('/protected').set('Authorization', '');

      expect(response.status).toBe(401);
    });

    it('should handle token with no role assigned', async () => {
      const payload: TokenPayload = {
        userId: 'user-123',
        email: 'no-role@example.com',
        // No role
        tenantId: 'tenant-456',
      };

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'ai-initializer',
        audience: 'ai-initializer-client',
      });

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('No role assigned');
    });
  });
});
