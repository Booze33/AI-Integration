import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function GET(request: NextRequest) {
  try {
    const backendUrl = appConfig.apiUrl;
    const search = request.nextUrl.search || '';

    const response = await apiFetch(`${backendUrl}/api/pipeline/jobs${search}`, {
      method: 'GET',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const jobs = Array.isArray(data?.jobs)
      ? data.jobs.map((job: any) => ({
          jobId: job.id,
          fileId: job.fileId,
          status: job.status,
          progress: job.progress,
          chunks: job.chunks,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }))
      : [];

    return NextResponse.json({ jobs, total: jobs.length });
  } catch (error) {
    console.error('Pipeline jobs list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
