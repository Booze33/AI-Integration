const isProduction = process.env.NODE_ENV === 'production';

const devFallbacks: Record<'NEXT_PUBLIC_API_URL' | 'NEXT_PUBLIC_DEFAULT_TENANT_ID', string> = {
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  NEXT_PUBLIC_DEFAULT_TENANT_ID: 'default-tenant',
};

const readRequired = (key: 'NEXT_PUBLIC_API_URL' | 'NEXT_PUBLIC_DEFAULT_TENANT_ID'): string => {
  const value = process.env[key]?.trim();
  if (value) {
    return value;
  }

  if (!isProduction) {
    const fallback = devFallbacks[key];
    console.warn(`[config] Missing ${key}; using development fallback: ${fallback}`);
    return fallback;
  }

  throw new Error(`Missing required environment variable: ${key}`);
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
