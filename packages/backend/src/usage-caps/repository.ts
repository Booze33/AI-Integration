import { Pool } from 'pg';
import {
  RecordUsageInput,
  TenantTokenCaps,
  UpsertTenantTokenCapsInput,
  UsageSnapshot,
} from './types';

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMonthStart(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export class UsageCapsRepository {
  constructor(private readonly pool: Pool) {}

  async getTenantCaps(tenantId: string): Promise<TenantTokenCaps | null> {
    const result = await this.pool.query(
      `SELECT tenant_id, daily_cap_tokens, monthly_cap_tokens, hard_cap_enabled
       FROM tenant.ai_token_caps
       WHERE tenant_id = $1`,
      [tenantId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      tenantId: row.tenant_id,
      dailyCapTokens: row.daily_cap_tokens === null ? null : Number(row.daily_cap_tokens),
      monthlyCapTokens: row.monthly_cap_tokens === null ? null : Number(row.monthly_cap_tokens),
      hardCapEnabled: Boolean(row.hard_cap_enabled),
    };
  }

  async upsertTenantCaps(
    tenantId: string,
    actorUserId: string,
    input: UpsertTenantTokenCapsInput
  ): Promise<TenantTokenCaps> {
    const hasDaily = Object.prototype.hasOwnProperty.call(input, 'dailyCapTokens');
    const hasMonthly = Object.prototype.hasOwnProperty.call(input, 'monthlyCapTokens');
    const hasHardCapEnabled = Object.prototype.hasOwnProperty.call(input, 'hardCapEnabled');

    const result = await this.pool.query(
      `INSERT INTO tenant.ai_token_caps (
         tenant_id,
         daily_cap_tokens,
         monthly_cap_tokens,
         hard_cap_enabled,
         created_by,
         updated_by,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, COALESCE($4, true), $5, $5, NOW(), NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         daily_cap_tokens = CASE WHEN $6 THEN $2 ELSE tenant.ai_token_caps.daily_cap_tokens END,
         monthly_cap_tokens = CASE WHEN $7 THEN $3 ELSE tenant.ai_token_caps.monthly_cap_tokens END,
         hard_cap_enabled = CASE WHEN $8 THEN COALESCE($4, tenant.ai_token_caps.hard_cap_enabled) ELSE tenant.ai_token_caps.hard_cap_enabled END,
         updated_by = $5,
         updated_at = NOW()
       RETURNING tenant_id, daily_cap_tokens, monthly_cap_tokens, hard_cap_enabled`,
      [
        tenantId,
        input.dailyCapTokens === undefined ? null : input.dailyCapTokens,
        input.monthlyCapTokens === undefined ? null : input.monthlyCapTokens,
        input.hardCapEnabled,
        actorUserId,
        hasDaily,
        hasMonthly,
        hasHardCapEnabled,
      ]
    );

    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      dailyCapTokens: row.daily_cap_tokens === null ? null : Number(row.daily_cap_tokens),
      monthlyCapTokens: row.monthly_cap_tokens === null ? null : Number(row.monthly_cap_tokens),
      hardCapEnabled: Boolean(row.hard_cap_enabled),
    };
  }

  async getUsageSnapshot(tenantId: string, now: Date = new Date()): Promise<UsageSnapshot> {
    const day = utcDay(now);
    const month = utcMonthStart(now);

    const [dailyResult, monthlyResult] = await Promise.all([
      this.pool.query(
        `SELECT total_tokens
         FROM app.ai_token_usage_rollups_daily
         WHERE tenant_id = $1 AND usage_date_utc = $2`,
        [tenantId, day]
      ),
      this.pool.query(
        `SELECT total_tokens
         FROM app.ai_token_usage_rollups_monthly
         WHERE tenant_id = $1 AND usage_month_utc = $2`,
        [tenantId, month]
      ),
    ]);

    return {
      tenantId,
      dailyUsedTokens: Number(dailyResult.rows[0]?.total_tokens || 0),
      monthlyUsedTokens: Number(monthlyResult.rows[0]?.total_tokens || 0),
      usageDateUtc: day,
      usageMonthUtc: month,
    };
  }

  async recordUsage(input: RecordUsageInput): Promise<void> {
    const client = await this.pool.connect();
    const now = input.occurredAt ?? new Date();
    const day = utcDay(now);
    const month = utcMonthStart(now);

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO app.ai_token_usage_events (
           tenant_id,
           user_id,
           route_source,
           provider,
           model,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           is_estimated,
           created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.tenantId,
          input.userId,
          input.routeSource,
          input.provider || null,
          input.model || null,
          input.promptTokens,
          input.completionTokens,
          input.totalTokens,
          input.isEstimated ?? false,
          now.toISOString(),
        ]
      );

      await client.query(
        `INSERT INTO app.ai_token_usage_rollups_daily (
           tenant_id,
           usage_date_utc,
           total_tokens,
           request_count,
           updated_at
         ) VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (tenant_id, usage_date_utc)
         DO UPDATE SET
           total_tokens = app.ai_token_usage_rollups_daily.total_tokens + EXCLUDED.total_tokens,
           request_count = app.ai_token_usage_rollups_daily.request_count + 1,
           updated_at = NOW()`,
        [input.tenantId, day, input.totalTokens]
      );

      await client.query(
        `INSERT INTO app.ai_token_usage_rollups_monthly (
           tenant_id,
           usage_month_utc,
           total_tokens,
           request_count,
           updated_at
         ) VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (tenant_id, usage_month_utc)
         DO UPDATE SET
           total_tokens = app.ai_token_usage_rollups_monthly.total_tokens + EXCLUDED.total_tokens,
           request_count = app.ai_token_usage_rollups_monthly.request_count + 1,
           updated_at = NOW()`,
        [input.tenantId, month, input.totalTokens]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
