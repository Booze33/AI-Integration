import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const cookieHeader = request.headers.get('cookie') || '';

    if (!cookieHeader) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'No auth cookies' },
        { status: 401 }
      );
    }

    const response = await fetch(`${backendUrl}/auth/me`, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
      },
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Me API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to get user' },
      { status: 500 }
    );
  }
}
