import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
        ...(request.headers.get('last-event-id')
          ? { 'Last-Event-ID': request.headers.get('last-event-id') as string }
          : {}),
      },
      body,
    });

    if (!response.ok && !response.body) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'Chat request failed', message: errorText || response.statusText },
        { status: response.status }
      );
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
    console.error('Chat proxy error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to proxy chat request' },
      { status: 500 }
    );
  }
}
