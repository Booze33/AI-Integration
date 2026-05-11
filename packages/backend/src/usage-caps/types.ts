export interface TenantTokenCaps {
  tenantId: string;
  dailyCapTokens: number | null;
  monthlyCapTokens: number | null;
  hardCapEnabled: boolean;
}

export interface UsageSnapshot {
  tenantId: string;
  dailyUsedTokens: number;
  monthlyUsedTokens: number;
  usageDateUtc: string;
  usageMonthUtc: string;
}

export interface AllowanceCheckResult {
  allowed: boolean;
  reasonCode?: 'TENANT_TOKEN_DAILY_CAP_EXCEEDED' | 'TENANT_TOKEN_MONTHLY_CAP_EXCEEDED';
  dailyCapTokens: number | null;
  monthlyCapTokens: number | null;
  dailyUsedTokens: number;
  monthlyUsedTokens: number;
  estimatedRequestTokens: number;
  retryAtUtc: string | null;
}

export interface RecordUsageInput {
  tenantId: string;
  userId: string;
  routeSource: string;
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isEstimated?: boolean;
  occurredAt?: Date;
}

export interface UpsertTenantTokenCapsInput {
  dailyCapTokens?: number | null;
  monthlyCapTokens?: number | null;
  hardCapEnabled?: boolean;
}
