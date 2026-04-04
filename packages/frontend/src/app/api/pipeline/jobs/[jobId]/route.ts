import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const { jobId } = await params;

    const response = await fetch(`${backendUrl}/pipeline/jobs/${jobId}`, {
      method: 'GET',
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Pipeline job status error:', error);
    return NextResponse.json(
      { error: 'Status check failed', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
