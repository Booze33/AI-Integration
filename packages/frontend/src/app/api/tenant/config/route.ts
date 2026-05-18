import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { OPENAI_API_BASE_URL } from '@/lib/constants';
import { apiFetch } from '@/lib/api/client';

const BACKEND_URL = appConfig.apiUrl;
const MOCK_MODE = appConfig.mockMode;

// GET /api/tenant/config - Get all tenant configurations
export async function GET(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    if (!cookieHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return mock data if in mock mode
    if (MOCK_MODE) {
      return NextResponse.json({
        success: true,
        data: [
          {
            id: 'mock-config-1',
            tenant_id: 'mock-tenant',
            provider: 'openai',
            api_key_encrypted: 'encrypted-key',
            api_key_iv: 'mock-iv',
            base_url: OPENAI_API_BASE_URL,
            default_model: 'gpt-4',
            timeout_ms: 30000,
            is_active: true,
            metadata: {},
            created_by: 'mock-user',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }

    const response = await apiFetch(`${BACKEND_URL}/api/tenant/config`, {
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.error || 'Failed to fetch configurations' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/tenant/config - Create new configuration
export async function POST(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    if (!cookieHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const response = await apiFetch(`${BACKEND_URL}/api/tenant/config`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.error || 'Failed to create configuration' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
