import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuditService,
  getClientInfo,
  startAuditCleanupJob,
  AUDIT_CLEANUP_INTERVAL_MS,
} from '../service';
import { logAudit } from '../middleware';

describe('AuditService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not throw when audit logging is disabled or uninitialized', async () => {
    await expect(
      logAudit(undefined, {
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'TEST',
        resource: 'TEST_RESOURCE',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        statusCode: 200,
      })
    ).resolves.toBeUndefined();
  });

  it('catches insert failures and logs to console without throwing', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: null })
        .mockRejectedValueOnce(new Error('db insert failed')),
    } as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new AuditService(pool, 90);

    await expect(
      service.log({
        tenantId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
        action: 'LOGIN',
        resource: 'AUTH',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        statusCode: 200,
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith('Audit logging failed:', expect.any(Error));
  });

  it('deletes old audit logs based on retention days', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: null })
        .mockResolvedValueOnce({ rowCount: 7 }),
    } as any;

    const service = new AuditService(pool, 30);
    const deleted = await service.cleanOldLogs();

    expect(deleted).toBe(7);
    expect(pool.query.mock.calls[1][0]).toContain("INTERVAL '30 days'");
  });

  it('runs the cleanup job on a schedule', async () => {
    const cleanOldLogs = vi.fn().mockResolvedValue(0);
    const service = { cleanOldLogs } as unknown as AuditService;

    const timer = startAuditCleanupJob(service, 1000);
    expect(timer).toBeDefined();

    await vi.advanceTimersByTimeAsync(3000);
    clearInterval(timer);

    expect(cleanOldLogs).toHaveBeenCalledTimes(3);
    expect(AUDIT_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('extracts ip_address from X-Forwarded-For when behind a proxy', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.5',
        'user-agent': 'proxy-test-agent',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };

    const info = getClientInfo(req);
    expect(info.ipAddress).toBe('203.0.113.10');
    expect(info.userAgent).toBe('proxy-test-agent');
  });
});
