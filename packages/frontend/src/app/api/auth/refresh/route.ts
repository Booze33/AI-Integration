import { NextRequest, NextResponse } from 'next/server';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const refreshToken = request.cookies.get('refreshToken')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Refresh token cookie is required' },
        { status: 401 }
      );
    }

    const response = await fetch(`${backendUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
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

      res.cookies.set('accessToken', data.accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: 15 * 60,
      });
      res.cookies.set('refreshToken', data.refreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60,
      });

      return res;
    }

    return NextResponse.json(
      { error: 'Auth error', message: 'Missing tokens from backend' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Refresh API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
