import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, validateEnv } from '../env';

function applyBaseEnv(key: string) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.TENANT_CONFIG_ENCRYPTION_KEY = key;
}

describe('Environment validation for TENANT_CONFIG_ENCRYPTION_KEY', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
    vi.restoreAllMocks();
  });

  it('accepts an encryption key that is exactly 32 characters', () => {
    applyBaseEnv('12345678901234567890123456789012');

    const env = validateEnv();
    expect(env.TENANT_CONFIG_ENCRYPTION_KEY).toBe('12345678901234567890123456789012');
  });

  it('fails startup when encryption key is shorter than 32 characters', () => {
    applyBaseEnv('short-key');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    expect(() => validateEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails startup when encryption key is longer than 32 characters', () => {
    applyBaseEnv('123456789012345678901234567890123');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    expect(() => validateEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
