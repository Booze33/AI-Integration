import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const { sessionId } = await params;

    // Get the raw audio data
    const audioData = await request.arrayBuffer();

    const response = await fetch(`${backendUrl}/api/chat/transcribe/${sessionId}`, {
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
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const { sessionId } = await params;

    const response = await fetch(`${backendUrl}/api/chat/transcribe/${sessionId}`, {
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
