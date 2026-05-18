import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

const BACKEND_URL = appConfig.apiUrl;
const MOCK_MODE = appConfig.mockMode;

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
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
            capabilities: {
              chat: true,
              chatStream: true,
              transcribe: true,
              realtimeTranscribe: false,
              speak: true,
              embed: true,
              embedBatch: true,
            },
          },
          {
            name: 'anthropic',
            displayName: 'Anthropic',
            requiresApiKey: true,
            capabilities: {
              chat: true,
              chatStream: true,
              transcribe: false,
              realtimeTranscribe: false,
              speak: false,
              embed: false,
              embedBatch: false,
            },
          },
          {
            name: 'deepgram',
            displayName: 'Deepgram',
            requiresApiKey: true,
            capabilities: {
              chat: false,
              chatStream: false,
              transcribe: true,
              realtimeTranscribe: true,
              speak: false,
              embed: false,
              embedBatch: false,
            },
          },
          {
            name: 'elevenlabs',
            displayName: 'ElevenLabs',
            requiresApiKey: true,
            capabilities: {
              chat: false,
              chatStream: false,
              transcribe: false,
              realtimeTranscribe: false,
              speak: true,
              embed: false,
              embedBatch: false,
            },
          },
        ],
      });
    }

    // Forward the request to the backend
    const response = await apiFetch(`${BACKEND_URL}/api/tenant/providers`, {
      headers: {
        Cookie: cookieHeader,
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
