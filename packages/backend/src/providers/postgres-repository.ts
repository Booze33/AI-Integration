/**
 * PostgreSQL Repository for Tenant AI Configurations
 *
 * Implements the TenantAIConfigRepository interface using PostgreSQL.
 * Handles database operations for tenant AI provider configurations.
 */

import { Pool, PoolClient } from 'pg';
import { TenantAIConfigRepository, TenantAIConfig, TenantAIConfigInput } from './tenant-config';
import { ProviderName } from './types';

export class PostgreSQLTenantAIConfigRepository implements TenantAIConfigRepository {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  /**
   * Execute a query with automatic connection management
   */
  private async executeQuery<T>(
    query: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<T[]> {
    const connection = client || this.pool;
    try {
      const result = await connection.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  /**
   * Execute a single row query
   */
  private async executeQuerySingle<T>(
    query: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<T | null> {
    const rows = await this.executeQuery<T>(query, params, client);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find configuration by ID
   */
  async findById(id: string): Promise<TenantAIConfig | null> {
    const query = `
      SELECT
        id,
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM tenant.ai_configs
      WHERE id = $1
    `;

    return this.executeQuerySingle<TenantAIConfig>(query, [id]);
  }

  /**
   * Find configuration by tenant and provider
   */
  async findByTenantAndProvider(
    tenantId: string,
    provider: ProviderName
  ): Promise<TenantAIConfig | null> {
    const query = `
      SELECT
        id,
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM tenant.ai_configs
      WHERE tenant_id = $1 AND provider = $2 AND is_active = true
    `;

    return this.executeQuerySingle<TenantAIConfig>(query, [tenantId, provider]);
  }

  /**
   * Find all active configurations for a tenant
   */
  async findActiveByTenant(tenantId: string): Promise<TenantAIConfig[]> {
    const query = `
      SELECT
        id,
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
      FROM tenant.ai_configs
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `;

    return this.executeQuery<TenantAIConfig>(query, [tenantId]);
  }

  /**
   * Create a new tenant AI configuration
   */
  async create(
    tenantId: string,
    input: TenantAIConfigInput,
    createdBy: string
  ): Promise<TenantAIConfig> {
    const query = `
      INSERT INTO tenant.ai_configs (
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
      )
      RETURNING
        id,
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
    `;

    const params = [
      tenantId,
      input.provider,
      input.api_key, // This should already be encrypted by the service
      input.api_key_iv || 'dummy-iv', // Use provided IV or fallback for backward compatibility
      input.base_url,
      input.organization,
      input.default_model,
      input.default_voice_id,
      input.timeout_ms,
      input.max_retries,
      true, // is_active
      JSON.stringify(input.metadata || {}),
      createdBy,
      createdBy,
    ];

    const result = await this.executeQuerySingle<TenantAIConfig>(query, params);
    if (!result) {
      throw new Error('Failed to create tenant AI configuration');
    }

    return result;
  }

  /**
   * Update an existing tenant AI configuration
   */
  async update(
    id: string,
    input: Partial<TenantAIConfigInput>,
    updatedBy: string
  ): Promise<TenantAIConfig> {
    // Build dynamic update query
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.provider !== undefined) {
      updateFields.push(`provider = $${paramIndex++}`);
      params.push(input.provider);
    }

    if (input.api_key !== undefined) {
      updateFields.push(`api_key_encrypted = $${paramIndex++}`);
      params.push(input.api_key); // Should already be encrypted
      updateFields.push(`api_key_iv = $${paramIndex++}`);
      params.push(input.api_key_iv || 'dummy-iv'); // Use provided IV or fallback for backward compatibility
    }

    if (input.base_url !== undefined) {
      updateFields.push(`base_url = $${paramIndex++}`);
      params.push(input.base_url);
    }

    if (input.organization !== undefined) {
      updateFields.push(`organization = $${paramIndex++}`);
      params.push(input.organization);
    }

    if (input.default_model !== undefined) {
      updateFields.push(`default_model = $${paramIndex++}`);
      params.push(input.default_model);
    }

    if (input.default_voice_id !== undefined) {
      updateFields.push(`default_voice_id = $${paramIndex++}`);
      params.push(input.default_voice_id);
    }

    if (input.timeout_ms !== undefined) {
      updateFields.push(`timeout_ms = $${paramIndex++}`);
      params.push(input.timeout_ms);
    }

    if (input.max_retries !== undefined) {
      updateFields.push(`max_retries = $${paramIndex++}`);
      params.push(input.max_retries);
    }

    if (input.metadata !== undefined) {
      updateFields.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(input.metadata));
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    updateFields.push(`updated_by = $${paramIndex++}`);
    params.push(updatedBy);

    updateFields.push(`updated_at = NOW()`);

    const query = `
      UPDATE tenant.ai_configs
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING
        id,
        tenant_id,
        provider,
        api_key_encrypted,
        api_key_iv,
        base_url,
        organization,
        default_model,
        default_voice_id,
        timeout_ms,
        max_retries,
        is_active,
        metadata,
        created_by,
        updated_by,
        created_at,
        updated_at
    `;

    params.push(id);

    const result = await this.executeQuerySingle<TenantAIConfig>(query, params);
    if (!result) {
      throw new Error('Configuration not found or update failed');
    }

    return result;
  }

  /**
   * Deactivate a tenant AI configuration (soft delete)
   */
  async deactivate(id: string, updatedBy: string): Promise<void> {
    const query = `
      UPDATE tenant.ai_configs
      SET is_active = false, updated_by = $2, updated_at = NOW()
      WHERE id = $1
    `;

    await this.executeQuery(query, [id, updatedBy]);
  }

  /**
   * Delete a tenant AI configuration (hard delete)
   */
  async delete(id: string): Promise<void> {
    const query = `DELETE FROM tenant.ai_configs WHERE id = $1`;
    await this.executeQuery(query, [id]);
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Health check for the database connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.executeQuerySingle('SELECT NOW() as time', []);
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
}
