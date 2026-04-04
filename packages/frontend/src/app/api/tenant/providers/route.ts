import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

// Helper function to get auth token from request cookies
function getAuthToken(request: NextRequest): string | null {
  const cookie = request.cookies.get('token');
  return cookie?.value || null;
}

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
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
          },
          {
            name: 'anthropic',
            displayName: 'Anthropic',
            requiresApiKey: true,
          },
          {
            name: 'deepgram',
            displayName: 'Deepgram',
            requiresApiKey: true,
          },
          {
            name: 'elevenlabs',
            displayName: 'ElevenLabs',
            requiresApiKey: true,
          },
        ],
      });
    }

    // Forward the request to the backend
    const response = await fetch(`${BACKEND_URL}/api/tenant/providers`, {
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch providers' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
