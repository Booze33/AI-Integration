import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createDashboardRoutes } from '../routes';

const mockAuthUser = {
  userId: 'dashboard-user',
  email: 'dashboard@example.com',
  role: 'viewer',
  tenantId: 'tenant-dashboard' as string | undefined,
};

const mockUsageSnapshot = vi.hoisted(() =>
  vi.fn(async (_tenantId?: string) => ({
    monthlyUsedTokens: 321,
  }))
);

const mockQueueStats = vi.hoisted(() =>
  vi.fn(async () => ({
    waiting: 1,
    active: 0,
    completed: 5,
    failed: 0,
    delayed: 0,
  }))
);

vi.mock('../../auth/middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { ...mockAuthUser };
    next();
  },
  requireViewer: (_req: any, _res: any, next: any) => next(),
  requireTenant: () => (req: any, res: any, next: any) => {
    if (!req.user?.tenantId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Tenant ID required in JWT token',
      });
      return;
    }
    req.tenantId = req.user.tenantId;
    next();
  },
}));

vi.mock('../../pipeline/singleton', () => ({
  getPipelineService: () => ({
    getQueueStats: () => mockQueueStats(),
    getAllJobs: () => [{ status: 'completed' }, { status: 'failed' }],
  }),
}));

vi.mock('../../usage-caps', () => ({
  UsageCapsService: {
    fromPool: () => ({
      getUsageSnapshot: (tenantId: string) => mockUsageSnapshot(tenantId),
    }),
  },
}));

function createMockPool(): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT stream_id)')) {
        return { rows: [{ total_chats: '2' }] };
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
}

describe('Dashboard Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    mockAuthUser.tenantId = 'tenant-dashboard';
    mockUsageSnapshot.mockClear();
    mockQueueStats.mockClear();

    app = express();
    app.use(express.json());
    app.use('/api/dashboard', createDashboardRoutes(createMockPool()));
  });

  it('returns stats for authenticated tenant', async () => {
    const response = await request(app).get('/api/dashboard/stats').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.stats.tokensUsed).toBe(321);
    expect(mockUsageSnapshot).toHaveBeenCalledWith('tenant-dashboard');
  });

  it('rejects missing JWT tenant even when x-tenant-id header is provided', async () => {
    mockAuthUser.tenantId = undefined;

    const response = await request(app)
      .get('/api/dashboard/stats')
      .set('x-tenant-id', 'tenant-from-header')
      .expect(400);

    expect(response.body).toEqual({
      error: 'Bad Request',
      message: 'Tenant ID required in JWT token',
    });
    expect(mockUsageSnapshot).not.toHaveBeenCalled();
  });
});
