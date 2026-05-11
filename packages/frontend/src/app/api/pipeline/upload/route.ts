import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;

    // Get the form data from the request
    const formData = await request.formData();

    // Forward to backend
    const response = await apiFetch(`${backendUrl}/api/pipeline/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
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
