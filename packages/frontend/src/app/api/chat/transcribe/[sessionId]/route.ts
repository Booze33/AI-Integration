import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const backendUrl = appConfig.apiUrl;
    const { sessionId } = await params;

    const response = await apiFetch(`${backendUrl}/api/chat/transcribe/${sessionId}`, {
      method: 'GET',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(errorData, { status: response.status });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': response.headers.get('cache-control') || 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Transcription stream error:', error);
    return NextResponse.json({ error: 'Failed to open transcription stream' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const backendUrl = appConfig.apiUrl;
    const { sessionId } = await params;

    // Get the raw audio data
    const audioData = await request.arrayBuffer();

    const response = await apiFetch(`${backendUrl}/api/chat/transcribe/${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: request.headers.get('cookie') || '',
      },
      body: audioData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(errorData, { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Audio send error:', error);
    return NextResponse.json({ error: 'Failed to send audio data' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const backendUrl = appConfig.apiUrl;
    const { sessionId } = await params;

    const response = await apiFetch(`${backendUrl}/api/chat/transcribe/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(errorData, { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Session close error:', error);
    return NextResponse.json({ error: 'Failed to close session' }, { status: 500 });
  }
}
