import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function GET(_request: NextRequest) {
  try {
    const cookieHeader = _request.headers.get('cookie') || '';
    const response = await fetch(`${BACKEND_URL}/api/chat/history`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Chat history GET error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to load history' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cookieHeader = request.headers.get('cookie') || '';
    const response = await fetch(`${BACKEND_URL}/api/chat/history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Chat history POST error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to save history' },
      { status: 500 }
    );
  }
}
