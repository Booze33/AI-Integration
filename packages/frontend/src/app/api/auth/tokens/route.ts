import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;
    const cookieHeader = request.headers.get('cookie') || '';

    const response = await apiFetch(`${backendUrl}/auth/tokens`, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
      },
    });

    const data = await response.json().catch(() => ({
      error: 'Invalid response',
      message: 'Failed to fetch active sessions',
    }));

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Auth tokens GET API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to get active sessions' },
      { status: 500 }
    );
  }
}
