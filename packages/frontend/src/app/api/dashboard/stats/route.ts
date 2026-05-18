import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

const MOCK_MODE = appConfig.mockMode;

export async function GET(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('Cookie') || '';
    if (!cookieHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (MOCK_MODE) {
      return NextResponse.json({
        success: true,
        stats: {
          totalChats: 12,
          filesUploaded: 8,
          tokensUsed: 2500,
          apiCalls: 156,
          queueStats: {
            waiting: 2,
            active: 1,
            completed: 45,
            failed: 3,
            delayed: 0,
          },
        },
      });
    }

    // Get the backend URL from environment variable or use default
    const backendUrl = appConfig.apiUrl;

    // Forward the request to the backend
    const response = await apiFetch(`${backendUrl}/api/dashboard/stats`, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      let errorMessage = 'Failed to fetch dashboard stats';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // keep default error message when backend response is not JSON
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Dashboard stats API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
