const readRequired = (key: 'NEXT_PUBLIC_API_URL' | 'NEXT_PUBLIC_DEFAULT_TENANT_ID'): string => {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
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
  isProduction: process.env.NODE_ENV === 'production',
};
