/**
 * Environment Variable Validation
 *
 * Validates all required environment variables on startup.
 * Ensures the application has all necessary configuration before running.
 */

import { z } from 'zod';

/**
 * Define the environment schema
 */
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Server configuration
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Database configuration
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection URL'),

  // Redis configuration
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection URL'),

  // JWT configuration
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  JWT_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Encryption configuration
  TENANT_CONFIG_ENCRYPTION_KEY: z
    .string()
    .length(32, 'TENANT_CONFIG_ENCRYPTION_KEY must be exactly 32 characters'),

  // Rate limiting configuration
  RATE_LIMIT_USER_MAX: z.coerce.number().min(1).default(100),
  RATE_LIMIT_TENANT_MAX: z.coerce.number().min(1).default(1000),
  RATE_LIMIT_IP_MAX: z.coerce.number().min(1).default(50),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1000).default(900000),

  // Audit logging configuration
  ENABLE_AUDIT_LOGGING: z
    .string()
    .default('true')
    .transform((v: string) => v === 'true'),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().min(1).default(90),

  // CORS configuration
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: z
    .string()
    .default('true')
    .transform((v: string) => v === 'true'),

  // Max file upload size (in bytes)
  MAX_FILE_SIZE: z.coerce.number().min(1000).default(10485760), // 10MB default

  // AI Provider configuration (optional, can be set per-tenant later)
  ACTIVE_AI_PROVIDER: z.string().default('openai'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
});

export type Environment = z.infer<typeof envSchema>;

/**
 * Validate and return environment variables
 */
export function validateEnv(): Environment {
  // FIX 1: Removed `process.env` from the log — it would dump every secret
  // (JWT keys, DB passwords, encryption keys) to stdout, which is a data leak
  // especially when logs are shipped to external services.
  console.log('🔍 Validating environment variables...');

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const errorMessages: string[] = [];

    for (const field in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, field)) {
        const fieldErrors = errors[field as keyof typeof errors];
        if (fieldErrors) {
          errorMessages.push(`${field}: ${fieldErrors.join(', ')}`);
        }
      }
    }

    console.error('❌ Environment validation failed:');
    errorMessages.forEach((msg) => console.error(`  • ${msg}`));
    console.error('\nPlease check your .env file and try again.');

    process.exit(1);
  }

  const data = result.data;

  // FIX 5: Cross-field warning — if a provider is set but no key is provided,
  // fail loudly at startup instead of silently blowing up at runtime.
  if (data.ACTIVE_AI_PROVIDER && !data.AI_API_KEY) {
    console.warn(
      `⚠️  ACTIVE_AI_PROVIDER is set to "${data.ACTIVE_AI_PROVIDER}" but AI_API_KEY is not provided. ` +
        `This may cause runtime failures unless keys are configured per-tenant.`
    );
  }

  return data;
}

/**
 * Get validated environment variables (cached after first call)
 */
let cachedEnv: Environment | null = null;

export function getEnv(): Environment {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = validateEnv();
  return cachedEnv;
}

/**
 * FIX 2: Reset the env cache.
 *
 * The module-level `cachedEnv` variable never resets between test runs on its
 * own. If one test mutates `process.env`, subsequent calls to `getEnv()` will
 * silently return stale data, causing subtle hard-to-debug failures.
 *
 * Call this in your test `beforeEach` / `afterEach` hooks to guarantee a
 * fresh parse on every test.
 */
export function resetEnvCache(): void {
  cachedEnv = null;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === 'development';
}

/**
 * Check if running in test
 */
export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}

/**
 * Print environment configuration (safe version - masks secrets)
 */
export function printEnvConfig(): void {
  const env = getEnv();
  const safeEnv = {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    HOST: env.HOST,
    DATABASE_URL: maskSensitiveValue(env.DATABASE_URL),
    REDIS_URL: maskSensitiveValue(env.REDIS_URL),
    JWT_EXPIRY: env.JWT_EXPIRY,
    JWT_REFRESH_EXPIRY: env.JWT_REFRESH_EXPIRY,
    RATE_LIMIT_USER_MAX: env.RATE_LIMIT_USER_MAX,
    RATE_LIMIT_TENANT_MAX: env.RATE_LIMIT_TENANT_MAX,
    RATE_LIMIT_IP_MAX: env.RATE_LIMIT_IP_MAX,
    RATE_LIMIT_WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    ENABLE_AUDIT_LOGGING: env.ENABLE_AUDIT_LOGGING,
    AUDIT_LOG_RETENTION_DAYS: env.AUDIT_LOG_RETENTION_DAYS,
    CORS_ORIGIN: env.CORS_ORIGIN,
    MAX_FILE_SIZE: `${(env.MAX_FILE_SIZE / 1024 / 1024).toFixed(2)}MB`,
  };

  console.log('\n✅ Environment Configuration:');
  Object.entries(safeEnv).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  console.log('');
}

/**
 * FIX 4: Mask sensitive values in logs.
 *
 * The original implementation sliced the first/last 3 chars of any string,
 * which for a URL like `postgres://user:pass@host/db` still exposes structural
 * information (scheme, path). We now strip everything after the scheme for
 * URLs, and fall back to generic masking for non-URL strings.
 */
function maskSensitiveValue(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//*****`;
  } catch {
    // Not a URL — fall back to generic char masking
    if (value.length <= 8) {
      return '***';
    }
    const start = value.slice(0, 3);
    const end = value.slice(-3);
    const masked = '*'.repeat(Math.max(value.length - 6, 1));
    return `${start}${masked}${end}`;
  }
}

/**
 * Validate specific environment variable
 */
export function validateEnvVariable(
  key: string,
  value: string | undefined,
  rules: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (value: string) => boolean;
  }
): { valid: boolean; error?: string } {
  // FIX 3: The original used `!value` which is falsy for both `undefined` and
  // `""` (empty string). An explicit trim check is safer — it also catches
  // whitespace-only strings that would otherwise slip through as "present".
  if (rules.required && (value === undefined || value === null || value.trim() === '')) {
    return { valid: false, error: `${key} is required` };
  }

  if (!value) {
    return { valid: true };
  }

  if (rules.minLength && value.length < rules.minLength) {
    return {
      valid: false,
      error: `${key} must be at least ${rules.minLength} characters`,
    };
  }

  if (rules.maxLength && value.length > rules.maxLength) {
    return {
      valid: false,
      error: `${key} must be at most ${rules.maxLength} characters`,
    };
  }

  if (rules.pattern && !rules.pattern.test(value)) {
    return { valid: false, error: `${key} format is invalid` };
  }

  if (rules.custom && !rules.custom(value)) {
    return { valid: false, error: `${key} validation failed` };
  }

  return { valid: true };
}
