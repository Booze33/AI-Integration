import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: appConfig.isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 0,
};

export async function POST(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;
    const cookieHeader = request.headers.get('cookie') || '';

    const response = await apiFetch(`${backendUrl}/auth/logout-all`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
      },
    });

    const data = await response.json().catch(() => ({ message: 'Logged out from all devices' }));

    const res = NextResponse.json(data, { status: response.status });
    res.cookies.set('accessToken', '', COOKIE_OPTIONS);
    res.cookies.set('refreshToken', '', COOKIE_OPTIONS);

    return res;
  } catch (error) {
    console.error('Logout all API error:', error);
    const res = NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to logout from all devices' },
      { status: 500 }
    );
    res.cookies.set('accessToken', '', COOKIE_OPTIONS);
    res.cookies.set('refreshToken', '', COOKIE_OPTIONS);
    return res;
  }
}
