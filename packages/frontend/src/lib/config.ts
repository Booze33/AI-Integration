import { DEFAULT_API_BASE_URL } from './constants';

const isProduction = process.env.NODE_ENV === 'production';
type RequiredEnvKey = 'NEXT_PUBLIC_API_URL' | 'NEXT_PUBLIC_DEFAULT_TENANT_ID';

const missingRequiredEnvKeys = new Set<RequiredEnvKey>();

const devFallbacks: Record<RequiredEnvKey, string> = {
  NEXT_PUBLIC_API_URL: DEFAULT_API_BASE_URL,
  NEXT_PUBLIC_DEFAULT_TENANT_ID: 'default-tenant',
};

const readRequired = (key: RequiredEnvKey): string => {
  const value = process.env[key]?.trim();
  if (value) {
    return value;
  }

  const fallback = devFallbacks[key];

  if (!isProduction) {
    console.warn(`[config] Missing ${key}; using development fallback: ${fallback}`);
    return fallback;
  }

  missingRequiredEnvKeys.add(key);
  return fallback;
};

const readOptional = (key: string): string | undefined => {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
};

export const appConfig = {
  apiUrl: readRequired('NEXT_PUBLIC_API_URL'),
  defaultTenantId: readRequired('NEXT_PUBLIC_DEFAULT_TENANT_ID'),
  appName: readOptional('NEXT_PUBLIC_APP_NAME') || 'AI Integration',
  mockMode: readOptional('NEXT_PUBLIC_MOCK_MODE') === 'true',
  isProduction,
};

const missingKeys = Array.from(missingRequiredEnvKeys);

export const appConfigValidation = {
  isValid: missingKeys.length === 0,
  missingKeys,
  errorMessage:
    missingKeys.length > 0
      ? `Missing required environment variable${missingKeys.length > 1 ? 's' : ''}: ${missingKeys.join(', ')}`
      : undefined,
};

if (isProduction && !appConfigValidation.isValid) {
  console.error(`[config] ${appConfigValidation.errorMessage}`);
}
