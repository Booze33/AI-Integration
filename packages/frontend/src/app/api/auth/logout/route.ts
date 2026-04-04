import { NextRequest, NextResponse } from 'next/server';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 0,
};

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const refreshToken = request.cookies.get('refreshToken')?.value;

    if (refreshToken) {
      await fetch(`${backendUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    }

    const res = NextResponse.json({ message: 'Logged out' }, { status: 200 });
    res.cookies.set('accessToken', '', COOKIE_OPTIONS);
    res.cookies.set('refreshToken', '', COOKIE_OPTIONS);

    return res;
  } catch (error) {
    console.error('Logout API error:', error);
    const res = NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to logout' },
      { status: 500 }
    );
    res.cookies.set('accessToken', '', COOKIE_OPTIONS);
    res.cookies.set('refreshToken', '', COOKIE_OPTIONS);
    return res;
  }
}
