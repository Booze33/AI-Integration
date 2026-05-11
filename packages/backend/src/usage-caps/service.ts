import { Pool } from 'pg';
import { UsageCapsRepository } from './repository';
import {
  AllowanceCheckResult,
  RecordUsageInput,
  TenantTokenCaps,
  UpsertTenantTokenCapsInput,
  UsageSnapshot,
} from './types';

function startOfNextUtcDay(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

function startOfNextUtcMonth(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

export class UsageCapsService {
  constructor(private readonly repository: UsageCapsRepository) {}

  static fromPool(pool: Pool): UsageCapsService {
    return new UsageCapsService(new UsageCapsRepository(pool));
  }

  async getTenantCaps(tenantId: string): Promise<TenantTokenCaps | null> {
    return this.repository.getTenantCaps(tenantId);
  }

  async upsertTenantCaps(
    tenantId: string,
    actorUserId: string,
    input: UpsertTenantTokenCapsInput
  ): Promise<TenantTokenCaps> {
    return this.repository.upsertTenantCaps(tenantId, actorUserId, input);
  }

  async getUsageSnapshot(tenantId: string, now: Date = new Date()): Promise<UsageSnapshot> {
    return this.repository.getUsageSnapshot(tenantId, now);
  }

  async checkAllowance(
    tenantId: string,
    estimatedRequestTokens: number,
    now: Date = new Date()
  ): Promise<AllowanceCheckResult> {
    const [caps, usage] = await Promise.all([
      this.repository.getTenantCaps(tenantId),
      this.repository.getUsageSnapshot(tenantId, now),
    ]);

    const dailyCapTokens = caps?.dailyCapTokens ?? null;
    const monthlyCapTokens = caps?.monthlyCapTokens ?? null;
    const hardCapEnabled = caps?.hardCapEnabled ?? true;

    if (!hardCapEnabled) {
      return {
        allowed: true,
        dailyCapTokens,
        monthlyCapTokens,
        dailyUsedTokens: usage.dailyUsedTokens,
        monthlyUsedTokens: usage.monthlyUsedTokens,
        estimatedRequestTokens,
        retryAtUtc: null,
      };
    }

    if (dailyCapTokens !== null && usage.dailyUsedTokens + estimatedRequestTokens > dailyCapTokens) {
      return {
        allowed: false,
        reasonCode: 'TENANT_TOKEN_DAILY_CAP_EXCEEDED',
        dailyCapTokens,
        monthlyCapTokens,
        dailyUsedTokens: usage.dailyUsedTokens,
        monthlyUsedTokens: usage.monthlyUsedTokens,
        estimatedRequestTokens,
        retryAtUtc: startOfNextUtcDay(now),
      };
    }

    if (
      monthlyCapTokens !== null &&
      usage.monthlyUsedTokens + estimatedRequestTokens > monthlyCapTokens
    ) {
      return {
        allowed: false,
        reasonCode: 'TENANT_TOKEN_MONTHLY_CAP_EXCEEDED',
        dailyCapTokens,
        monthlyCapTokens,
        dailyUsedTokens: usage.dailyUsedTokens,
        monthlyUsedTokens: usage.monthlyUsedTokens,
        estimatedRequestTokens,
        retryAtUtc: startOfNextUtcMonth(now),
      };
    }

    return {
      allowed: true,
      dailyCapTokens,
      monthlyCapTokens,
      dailyUsedTokens: usage.dailyUsedTokens,
      monthlyUsedTokens: usage.monthlyUsedTokens,
      estimatedRequestTokens,
      retryAtUtc: null,
    };
  }

  async recordUsage(input: RecordUsageInput): Promise<void> {
    if (input.totalTokens <= 0) {
      return;
    }
    await this.repository.recordUsage(input);
  }
}

export function estimateTextTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  const chars = messages.reduce((acc, msg) => acc + msg.role.length + (msg.content || '').length + 10, 0);
  return Math.ceil(chars / 4);
}
