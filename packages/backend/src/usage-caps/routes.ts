import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthenticatedRequest, requireRole, requireTenant } from '../auth/middleware';
import { logAudit } from '../audit';
import { UsageCapsService } from './service';

export function createUsageCapsRoutes(pool: Pool): Router {
  const router = Router();
  const service = UsageCapsService.fromPool(pool);

  router.use(authenticate as any, requireTenant({ allowHeader: false, allowQuery: false }) as any);

  router.get('/', requireRole('admin', 'owner') as any, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId!;

    const [caps, usage] = await Promise.all([
      service.getTenantCaps(tenantId),
      service.getUsageSnapshot(tenantId),
    ]);

    res.json({
      success: true,
      data: {
        caps: caps || {
          tenantId,
          dailyCapTokens: null,
          monthlyCapTokens: null,
          hardCapEnabled: true,
        },
        usage,
      },
    });
  });

  router.put(
    '/',
    requireRole('admin', 'owner') as any,
    [
      body('dailyCapTokens').optional({ nullable: true }).isInt({ min: 1, max: 1000000000 }),
      body('monthlyCapTokens').optional({ nullable: true }).isInt({ min: 1, max: 10000000000 }),
      body('hardCapEnabled').optional().isBoolean(),
    ],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          res.status(400).json({
            success: false,
            errors: errors.array(),
          });
          return;
        }

        const authReq = req as AuthenticatedRequest;
        const tenantId = authReq.tenantId!;
        const userId = authReq.user!.userId;

        const updated = await service.upsertTenantCaps(tenantId, userId, {
          dailyCapTokens:
            req.body.dailyCapTokens === undefined ? undefined : req.body.dailyCapTokens,
          monthlyCapTokens:
            req.body.monthlyCapTokens === undefined ? undefined : req.body.monthlyCapTokens,
          hardCapEnabled:
            req.body.hardCapEnabled === undefined ? undefined : Boolean(req.body.hardCapEnabled),
        });

        await logAudit(req.auditService, {
          tenantId,
          userId,
          action: 'UPDATE_TOKEN_CAPS',
          resource: 'TENANT_TOKEN_CAPS',
          changes: {
            dailyCapTokens: updated.dailyCapTokens,
            monthlyCapTokens: updated.monthlyCapTokens,
            hardCapEnabled: updated.hardCapEnabled,
          },
          ipAddress: req.clientInfo?.ipAddress || 'unknown',
          userAgent: req.clientInfo?.userAgent || 'unknown',
          statusCode: 200,
        });

        const usage = await service.getUsageSnapshot(tenantId);

        res.json({
          success: true,
          data: {
            caps: updated,
            usage,
          },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get('/usage', requireRole('admin', 'owner') as any, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId!;

    const usage = await service.getUsageSnapshot(tenantId);
    res.json({ success: true, data: usage });
  });

  return router;
}
