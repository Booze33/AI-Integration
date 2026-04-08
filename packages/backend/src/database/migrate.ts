/**
 * Database Migration Runner
 *
 * Automatically runs migrations on application startup.
 * Uses node-pg-migrate for version-controlled database schema changes.
 */

import { Pool } from 'pg';
import path from 'path';
// FIX 1: Import the runner directly from the library
import * as pgMigrate from 'node-pg-migrate';
// FIX 2: Import child_process at the top
import { execSync } from 'child_process';

export interface MigrationConfig {
  databaseUrl: string;
  schema?: string;
  migrationsTable?: string;
  dir?: string;
  direction?: 'up' | 'down';
  count?: number;
  dryRun?: boolean;
  verbose?: boolean;
}

const DEFAULT_CONFIG: Partial<MigrationConfig> = {
  schema: 'public',
  migrationsTable: 'pgmigrations',
  dir: path.join(process.cwd(), 'packages', 'backend', 'src', 'database', 'migrations'),
  direction: 'up',
  verbose: process.env.NODE_ENV === 'development',
};

/**
 * Run database migrations
 */
export async function runMigrations(config: MigrationConfig): Promise<void> {
  const migrationConfig = { ...DEFAULT_CONFIG, ...config };

  if (!migrationConfig.databaseUrl) {
    throw new Error('Database URL is required for migrations');
  }

  const pool = new Pool({
    connectionString: migrationConfig.databaseUrl,
  });

  const client = await pool.connect();

  try {
    console.log('🔄 Running database migrations...');

    const runner =
      typeof pgMigrate === 'function' ? pgMigrate : (pgMigrate as any).default || pgMigrate;

    await runner({
      dbClient: client,
      migrationsTable: migrationConfig.migrationsTable ?? 'pgmigrations',
      dir: migrationConfig.dir ?? path.join(process.cwd(), 'src', 'database', 'migrations'),
      direction: migrationConfig.direction ?? 'up',
      count: migrationConfig.count,
      dryRun: migrationConfig.dryRun,
      verbose: migrationConfig.verbose,
      log: (msg: string) => console.log(`  ${msg}`),
    });

    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Create a new migration file
 */
export async function createMigration(
  name: string,
  config?: Partial<MigrationConfig>
): Promise<void> {
  const dir = config?.dir || DEFAULT_CONFIG.dir;

  if (!dir) {
    throw new Error('Migrations directory not specified');
  }

  console.log(`📝 Creating migration: ${name}`);

  try {
    // FIX 2: Using the pre-imported execSync
    execSync(`npx node-pg-migrate create ${name} --migrations-dir ${dir}`, {
      stdio: 'inherit',
    });
    console.log(`✅ Migration file created at ${dir}/${name}`);
  } catch (error) {
    console.error(`❌ Failed to create migration: ${error}`);
    throw error;
  }
}

export default { runMigrations, createMigration };
