import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;
    const cookieHeader = request.headers.get('cookie') || '';

    if (!cookieHeader) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'No auth cookies' },
        { status: 401 }
      );
    }

    const response = await apiFetch(`${backendUrl}/auth/me`, {
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
