import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

interface MockUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

const usersByTenantAndEmail = vi.hoisted(() => new Map<string, MockUser>());
const usersByTenantAndId = vi.hoisted(() => new Map<string, MockUser>());
const refreshTokenStore = vi.hoisted(() => new Map<string, string>());
const mockAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../database/tenant-context', () => {
  class MockTenantDatabase {
    static fromPool(_pool: unknown) {
      return new MockTenantDatabase();
    }

    async withTenant<T>(tenantId: string, callback: (client: any) => Promise<T>): Promise<T> {
      const client = {
        query: async (text: string, params: unknown[] = []) => {
          const sql = text.toLowerCase();

          if (sql.includes('from auth.users') && sql.includes('where email = $1')) {
            const email = String(params[0]);
            const user = usersByTenantAndEmail.get(`${tenantId}:${email}`);
            return {
              rows: user
                ? [
                    {
                      id: user.id,
                      tenant_id: user.tenantId,
                      email: user.email,
                      password_hash: user.passwordHash,
                      created_at: user.createdAt,
                      updated_at: user.updatedAt,
                    },
                  ]
                : [],
              rowCount: user ? 1 : 0,
            };
          }

          if (sql.includes('select role from auth.user_roles')) {
            const userId = String(params[0]);
            const user = usersByTenantAndId.get(`${tenantId}:${userId}`);
            return { rows: user ? [{ role: user.role }] : [], rowCount: user ? 1 : 0 };
          }

          if (sql.includes('insert into auth.users')) {
            const email = String(params[1]);
            const newUser: MockUser = {
              id: `user-${usersByTenantAndId.size + 1}`,
              tenantId,
              email,
              passwordHash: String(params[2]),
              role: 'member',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            usersByTenantAndEmail.set(`${tenantId}:${email}`, newUser);
            usersByTenantAndId.set(`${tenantId}:${newUser.id}`, newUser);
            return {
              rows: [
                {
                  id: newUser.id,
                  tenant_id: newUser.tenantId,
                  email: newUser.email,
                  password_hash: newUser.passwordHash,
                  created_at: newUser.createdAt,
                  updated_at: newUser.updatedAt,
                },
              ],
              rowCount: 1,
            };
          }

          if (sql.includes('insert into auth.user_roles')) {
            const userId = String(params[1]);
            const role = String(params[2]);
            const user = usersByTenantAndId.get(`${tenantId}:${userId}`);
            if (user) {
              user.role = role;
            }
            return { rows: [], rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
      };

      return callback(client);
    }

    async getRawConnection() {
      return {
        query: async (text: string, params: unknown[] = []) => {
          const sql = text.toLowerCase();
          if (sql.includes('from auth.users') && sql.includes('where email = $1')) {
            const email = String(params[0]);
            const user = Array.from(usersByTenantAndEmail.values()).find((u) => u.email === email);
            return {
              rows: user
                ? [
                    {
                      id: user.id,
                      tenant_id: user.tenantId,
                      email: user.email,
                      password_hash: user.passwordHash,
                      created_at: user.createdAt,
                      updated_at: user.updatedAt,
                    },
                  ]
                : [],
              rowCount: user ? 1 : 0,
            };
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      };
    }
  }

  return { TenantDatabase: MockTenantDatabase };
});

vi.mock('../../redis/client', () => ({
  storeRefreshToken: vi.fn(async (userId: string, tokenId: string) => {
    refreshTokenStore.set(tokenId, userId);
  }),
  verifyRefreshToken: vi.fn(async (tokenId: string) => refreshTokenStore.get(tokenId) ?? null),
  revokeRefreshToken: vi.fn(async (tokenId: string) => {
    refreshTokenStore.delete(tokenId);
  }),
  revokeAllUserTokens: vi.fn(async () => {}),
  getUserActiveTokens: vi.fn(async () => []),
}));

vi.mock('../../audit', async () => {
  const actual = await vi.importActual<any>('../../audit');
  return {
    ...actual,
    logAudit: mockAuditLog,
  };
});

import { authRoutes, setAuthPool } from '../routes';

describe('Auth route audit logging', () => {
  let app: express.Application;

  beforeEach(() => {
    usersByTenantAndEmail.clear();
    usersByTenantAndId.clear();
    refreshTokenStore.clear();
    mockAuditLog.mockClear();

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auditService = { log: vi.fn() };
      req.clientInfo = { ipAddress: '198.51.100.10', userAgent: 'auth-audit-test' };
      next();
    });

    setAuthPool({} as any);
    app.use('/auth', authRoutes);
  });

  it('writes register audit events', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'register@example.com', password: 'StrongPass123!', role: 'member' })
      .expect(201);

    expect(response.body.user.id).toBeDefined();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'REGISTER',
        resource: 'AUTH',
        statusCode: 201,
        ipAddress: '198.51.100.10',
        userAgent: 'auth-audit-test',
      })
    );
  });

  it('writes login audit events', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'login@example.com', password: 'StrongPass123!', role: 'member' })
      .expect(201);

    mockAuditLog.mockClear();

    await request(app)
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'StrongPass123!' })
      .expect(200);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'LOGIN',
        resource: 'AUTH',
        statusCode: 200,
        ipAddress: '198.51.100.10',
        userAgent: 'auth-audit-test',
      })
    );
  });

  it('writes logout audit events', async () => {
    const loginResponse = await request(app)
      .post('/auth/register')
      .send({ email: 'logout@example.com', password: 'StrongPass123!', role: 'member' })
      .expect(201);

    mockAuditLog.mockClear();

    await request(app)
      .post('/auth/logout')
      .send({ refreshToken: loginResponse.body.refreshToken })
      .expect(200);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'LOGOUT',
        resource: 'AUTH',
        statusCode: 200,
        ipAddress: '198.51.100.10',
        userAgent: 'auth-audit-test',
      })
    );
  });
});
