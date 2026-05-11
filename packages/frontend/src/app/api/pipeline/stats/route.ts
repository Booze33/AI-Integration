import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;

    const response = await apiFetch(`${backendUrl}/api/pipeline/stats`, {
      method: 'GET',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const stats = data?.stats || {};
    return NextResponse.json({
      waiting: stats.waiting || 0,
      active: stats.active || 0,
      completed: stats.completed || 0,
      failed: stats.failed || 0,
      delayed: stats.delayed || 0,
    });
  } catch (error) {
    console.error('Pipeline stats proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline stats', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
