import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { apiFetch } from '@/lib/api/client';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId } = await context.params;
    const backendUrl = appConfig.apiUrl;
    const cookieHeader = request.headers.get('cookie') || '';

    const response = await apiFetch(`${backendUrl}/auth/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
      headers: {
        Cookie: cookieHeader,
      },
    });

    const data = await response.json().catch(() => ({
      error: 'Invalid response',
      message: 'Failed to revoke session token',
    }));

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Auth token DELETE API error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to revoke session token' },
      { status: 500 }
    );
  }
}
