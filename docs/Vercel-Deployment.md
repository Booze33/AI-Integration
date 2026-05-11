# Vercel Frontend Deployment Guide

This guide deploys the Next.js frontend (`packages/frontend`) to Vercel.

## Prerequisites

- Vercel account
- Access to this git repository
- Backend API already deployed and reachable over HTTPS
- Required frontend environment variables

## 1. Import Project In Vercel

1. Open Vercel dashboard and click New Project.
2. Import this repository.
3. Configure project:
   - Framework preset: Next.js
   - Root directory: `packages/frontend`
   - Install command: `pnpm install`
   - Build command: `pnpm build`
   - Output directory: `.next`

## 2. Configure Environment Variables

Set these variables in Vercel Project Settings -> Environment Variables.

### Required

| Variable                        | Example                         | Purpose                                      |
| ------------------------------- | ------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | `https://api.example.com`       | Backend API base URL used by frontend client |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID` | `default-tenant` or tenant UUID | Default tenant identifier used by frontend   |

### Optional

| Variable                | Example          | Purpose                                              |
| ----------------------- | ---------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`  | `AI Integration` | Display app name                                     |
| `NEXT_PUBLIC_MOCK_MODE` | `false`          | Enable mock mode (`true` for demo-only environments) |

Important: this frontend expects `NEXT_PUBLIC_API_URL` (not `NEXT_PUBLIC_BACKEND_URL`).

## 3. Verify CORS On Backend

Your backend must allow the Vercel frontend origin in `CORS_ORIGIN`.

Example backend value:

```env
CORS_ORIGIN=https://your-frontend.vercel.app
```

If you have multiple origins, use comma-separated values.

## 4. Deploy

1. Click Deploy in Vercel.
2. Wait for build to complete.
3. Open generated URL and verify:
   - login/register work
   - dashboard loads
   - chat calls backend
   - upload requests reach backend

## 5. Recommended Production Settings

- Disable mock mode: `NEXT_PUBLIC_MOCK_MODE=false`
- Enable Vercel protection/SSO as needed
- Add custom domain and TLS
- Add error monitoring if used in your stack

## 6. Troubleshooting

### Build fails on Vercel

- Confirm `pnpm-lock.yaml` is committed.
- Confirm root directory is `packages/frontend`.
- Confirm Node version supports your dependencies.

### App loads but API calls fail

- Verify `NEXT_PUBLIC_API_URL` value.
- Confirm backend is reachable from public internet.
- Confirm backend CORS allows your Vercel domain.

### Login loop / unauthorized requests

- Check backend token cookie settings and HTTPS behavior.
- Ensure backend and frontend are using correct environment URLs.

## 7. Redeploy Process

When changing frontend env variables:

1. Update variable in Vercel settings.
2. Trigger a redeploy.
3. Hard refresh browser after deployment.
