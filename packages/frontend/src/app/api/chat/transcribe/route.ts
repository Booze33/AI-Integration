import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

function encodeSSE(event: string, payload: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;

    const sessionResponse = await apiFetch(`${backendUrl}/api/chat/transcribe/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({}),
    });

    if (!sessionResponse.ok) {
      const errorData = await sessionResponse.json();
      return NextResponse.json(errorData, { status: sessionResponse.status });
    }

    const sessionData = (await sessionResponse.json()) as { sessionId?: string };
    if (!sessionData.sessionId) {
      return NextResponse.json({ error: 'Missing transcription session id' }, { status: 500 });
    }

    const upstreamStreamResponse = await apiFetch(
      `${backendUrl}/api/chat/transcribe/${sessionData.sessionId}`,
      {
        method: 'GET',
        headers: {
          Cookie: request.headers.get('cookie') || '',
        },
      }
    );

    if (!upstreamStreamResponse.ok || !upstreamStreamResponse.body) {
      const errorData = await upstreamStreamResponse.json();
      return NextResponse.json(errorData, { status: upstreamStreamResponse.status });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const readyPayload = { sessionId: sessionData.sessionId };
        controller.enqueue(encoder.encode(encodeSSE('ready', readyPayload)));

        const reader = upstreamStreamResponse.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (value) {
              controller.enqueue(value);
            }
          }
          controller.enqueue(
            encoder.encode(encodeSSE('close', { sessionId: sessionData.sessionId }))
          );
          controller.close();
        } catch {
          controller.enqueue(
            encoder.encode(
              encodeSSE('transcription-error', { message: 'Transcription stream disconnected' })
            )
          );
          controller.close();
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Transcription stream bootstrap error:', error);
    return NextResponse.json({ error: 'Failed to start transcription stream' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;

    const response = await apiFetch(`${backendUrl}/api/chat/transcribe/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(errorData, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Transcription session error:', error);
    return NextResponse.json({ error: 'Failed to start transcription session' }, { status: 500 });
  }
}
