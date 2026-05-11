import { describe, it, expect, vi } from 'vitest';
import { UsageCapsService } from '../service';

describe('UsageCapsService', () => {
  it('blocks when estimated request exceeds daily cap', async () => {
    const repository = {
      getTenantCaps: vi.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        dailyCapTokens: 100,
        monthlyCapTokens: 1000,
        hardCapEnabled: true,
      }),
      getUsageSnapshot: vi.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        dailyUsedTokens: 90,
        monthlyUsedTokens: 200,
        usageDateUtc: '2026-04-30',
        usageMonthUtc: '2026-04-01',
      }),
      upsertTenantCaps: vi.fn(),
      recordUsage: vi.fn(),
    };

    const service = new UsageCapsService(repository as any);
    const result = await service.checkAllowance('tenant-1', 20, new Date('2026-04-30T10:00:00Z'));

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('TENANT_TOKEN_DAILY_CAP_EXCEEDED');
    expect(result.retryAtUtc).toBe('2026-05-01T00:00:00.000Z');
  });

  it('allows requests when caps are disabled', async () => {
    const repository = {
      getTenantCaps: vi.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        dailyCapTokens: 10,
        monthlyCapTokens: 20,
        hardCapEnabled: false,
      }),
      getUsageSnapshot: vi.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        dailyUsedTokens: 999,
        monthlyUsedTokens: 999,
        usageDateUtc: '2026-04-30',
        usageMonthUtc: '2026-04-01',
      }),
      upsertTenantCaps: vi.fn(),
      recordUsage: vi.fn(),
    };

    const service = new UsageCapsService(repository as any);
    const result = await service.checkAllowance('tenant-1', 100, new Date('2026-04-30T10:00:00Z'));

    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBeUndefined();
  });
});
