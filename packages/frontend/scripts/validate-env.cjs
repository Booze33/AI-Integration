/* eslint-disable no-console */

function isTruthy(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

const mockModeEnabled = isTruthy(process.env.NEXT_PUBLIC_MOCK_MODE);

// Vercel sets this to "production", "preview", or "development".
const vercelEnv = process.env.VERCEL_ENV;
const deployEnv = process.env.DEPLOY_ENV;
const nodeEnv = process.env.NODE_ENV;

const isProductionDeployment =
  (typeof vercelEnv === 'string' && vercelEnv === 'production') ||
  (typeof deployEnv === 'string' && deployEnv === 'production') ||
  (typeof vercelEnv !== 'string' && typeof deployEnv !== 'string' && nodeEnv === 'production');

if (isProductionDeployment && mockModeEnabled) {
  console.error('[validate-env] NEXT_PUBLIC_MOCK_MODE=true is not allowed for production deployments.');
  process.exit(1);
}

if (mockModeEnabled) {
  console.warn('[validate-env] Mock mode enabled for non-production environment.');
}
