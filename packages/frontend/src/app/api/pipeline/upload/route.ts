import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';

    // Get the form data from the request
    const formData = await request.formData();

    // Forward to backend
    const response = await fetch(`${backendUrl}/pipeline/upload/async`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Pipeline upload error:', error);
    return NextResponse.json(
      { error: 'Upload failed', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
