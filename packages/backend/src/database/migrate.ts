/**
 * Database Migration Runner
 *
 * Automatically runs migrations on application startup.
 * Uses node-pg-migrate for version-controlled database schema changes.
 */

import { Pool } from 'pg';
import path from 'path';

// Dynamic import to handle node-pg-migrate
async function getMigrationRunner() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migrationRunner = require('node-pg-migrate');
  return migrationRunner.default || migrationRunner;
}

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
  dir: path.join(__dirname, 'migrations'),
  direction: 'up',
  verbose: process.env.NODE_ENV === 'development',
};

/**
 * Run database migrations
 */
export async function runMigrations(config: MigrationConfig): Promise<void> {
  const migrationConfig = { ...DEFAULT_CONFIG, ...config };

  const pool = new Pool({
    connectionString: migrationConfig.databaseUrl,
  });

  try {
    console.log('🔄 Running database migrations...');

    const runner = await getMigrationRunner();
    const result = await runner({
      databaseClient: pool,
      migrationsTable: migrationConfig.migrationsTable,
      dir: migrationConfig.dir,
      direction: migrationConfig.direction,
      count: migrationConfig.count,
      dryRun: migrationConfig.dryRun,
      verbose: migrationConfig.verbose,
      log: (msg: string) => console.log(`  ${msg}`),
    });

    if (result.length === 0) {
      console.log('✅ No pending migrations');
    } else {
      console.log(`✅ Successfully ran ${result.length} migration(s)`);
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
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

  console.log(`📝 Creating migration: ${name}`);

  // Use node-pg-migrate CLI to create migration
  const { execSync } = await import('child_process');

  execSync(`npx node-pg-migrate create ${name} --migrations-dir ${dir}`, { stdio: 'inherit' });

  console.log('✅ Migration file created');
}

export default { runMigrations, createMigration };
