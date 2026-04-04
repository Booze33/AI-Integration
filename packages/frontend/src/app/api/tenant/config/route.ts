import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

// Helper function to get auth token from request cookies
function getAuthToken(request: NextRequest): string | null {
  const cookie = request.cookies.get('token');
  return cookie?.value || null;
}

// GET /api/tenant/config - Get all tenant configurations
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token && !MOCK_MODE) {
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
            base_url: 'https://api.openai.com',
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

    const response = await fetch(`${BACKEND_URL}/api/tenant/config`, {
      headers: {
        Cookie: `token=${token}`,
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
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const response = await fetch(`${BACKEND_URL}/api/tenant/config`, {
      method: 'POST',
      headers: {
        Cookie: `token=${token}`,
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
