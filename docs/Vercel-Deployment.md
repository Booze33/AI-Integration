# Vercel Deployment Guide

This guide explains how to deploy the AI Integration Platform frontend to Vercel.

## Prerequisites

- Vercel account
- Backend API deployed and accessible
- Environment variables configured

## Deployment Steps

### 1. Connect Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your Git repository
4. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `packages/frontend`
   - **Build Command**: `pnpm build`
   - **Output Directory**: `.next`

### 2. Environment Variables

Set the following environment variables in Vercel:

#### Required Variables

| Variable                  | Value                                 | Description      |
| ------------------------- | ------------------------------------- | ---------------- |
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-backend-api.vercel.app` | Backend API URL  |
| `NODE_ENV`                | `production`                          | Environment mode |

#### Optional Variables

| Variable                       | Value   | Description                               |
| ------------------------------ | ------- | ----------------------------------------- |
| `NEXT_PUBLIC_MOCK_MODE`        | `false` | Enable mock data when backend unavailable |
| `NEXT_PUBLIC_VERCEL_ANALYTICS` | `true`  | Enable Vercel Analytics                   |
| `NEXT_PUBLIC_ERROR_REPORTING`  | `true`  | Enable error reporting                    |

### 3. Build Settings

The `vercel.json` file in `packages/frontend/` contains:

```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "functions": {
    "src/app/api/**/*.ts": {
      "runtime": "@vercel/node"
    }
  },
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

### 4. Deploy

1. Click "Deploy" in Vercel
2. Monitor the build process
3. Once deployed, your app will be available at the generated URL

## Mock Mode

If you need to deploy without a backend, enable mock mode:

1. Set `NEXT_PUBLIC_MOCK_MODE=true` in Vercel environment variables
2. The app will use mock data for:
   - User authentication
   - AI provider configurations
   - Provider list

**Note**: Mock mode is for development/testing only. Disable it for production.

## Troubleshooting

### Build Fails

- Check that `packages/frontend/.env.example` variables are set
- Ensure backend URL is accessible
- Verify `pnpm` is available in build environment

### API Calls Fail

- Verify `NEXT_PUBLIC_BACKEND_URL` is correct
- Check backend CORS settings
- Enable mock mode temporarily for testing

### Environment Variables Not Working

- Environment variables must be set in Vercel dashboard
- Use `NEXT_PUBLIC_` prefix for client-side variables
- Redeploy after changing environment variables

## Production Checklist

- [ ] Backend API deployed and accessible
- [ ] `NEXT_PUBLIC_BACKEND_URL` set correctly
- [ ] `NEXT_PUBLIC_MOCK_MODE` set to `false`
- [ ] Domain configured (optional)
- [ ] SSL certificate enabled
- [ ] Analytics configured (optional)
