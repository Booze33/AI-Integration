import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: appConfig.isProduction,
  sameSite: 'lax' as const,
  path: '/',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // In development, backend is on localhost:3001
    // In production, adjust accordingly
    const backendUrl = appConfig.apiUrl;

    const response = await apiFetch(`${backendUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    if (data.accessToken && data.refreshToken) {
      const res = NextResponse.json(
        {
          message: data.message,
          user: data.user,
        },
        { status: response.status }
      );

      const MAX_AGE_ACCESS = 15 * 60; // 15 minutes
      const MAX_AGE_REFRESH = 7 * 24 * 60 * 60; // 7 days

      res.cookies.set('accessToken', data.accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: MAX_AGE_ACCESS,
      });
      res.cookies.set('refreshToken', data.refreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: MAX_AGE_REFRESH,
      });

      return res;
    }

    return NextResponse.json(
      { error: 'Auth error', message: 'Missing tokens from backend' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Register API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to register' },
      { status: 500 }
    );
  }
}
