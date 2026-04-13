import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const backendUrl = appConfig.apiUrl;
    const { jobId } = await params;

    const response = await apiFetch(`${backendUrl}/api/pipeline/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const job = data?.job;
    if (!job) {
      return NextResponse.json({ error: 'Invalid job payload' }, { status: 502 });
    }

    return NextResponse.json({
      jobId: job.id,
      fileId: job.fileId,
      status: job.status,
      progress: job.progress,
      chunks: job.chunks,
      chunkPreviews: job.chunkPreviews || [],
      chunkTexts: job.chunkTexts || [],
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    });
  } catch (error) {
    console.error('Pipeline job status error:', error);
    return NextResponse.json(
      { error: 'Status check failed', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
