'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';
import { clearAuthState, setAuthUser } from '../lib/auth-store';
import { appConfig } from '../lib/config';

const AUTH_CHECK_TIMEOUT_MS = 3000;

type BootstrapStatus = 'checking' | 'ready' | 'network-error';

interface MeResponse {
  user?: {
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    createdAt?: string;
  };
}

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BootstrapStatus>('checking');

  const runAuthCheck = useCallback(async () => {
    setStatus('checking');

    try {
      const response = (await Promise.race([
        apiFetch('/api/auth/me', { method: 'GET' }, { retryOnUnauthorized: false }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Auth check timeout')), AUTH_CHECK_TIMEOUT_MS);
        }),
      ])) as Response;

      if (response.status === 401) {
        clearAuthState(true);
        setStatus('ready');
        return;
      }

      if (!response.ok) {
        throw new Error('Unable to connect to server');
      }

      const data = (await response.json()) as MeResponse;
      if (data.user) {
        setAuthUser(data.user);
      } else {
        clearAuthState(true);
      }

      setStatus('ready');
    } catch (error) {
      console.error('Initial auth check failed:', error);
      clearAuthState(false);
      setStatus('network-error');
    }
  }, []);

  useEffect(() => {
    void runAuthCheck();
  }, [runAuthCheck]);

  if (status === 'checking') {
    return (
      <main className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100 px-4">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-sm">
            <span className="text-xl font-bold text-white">A</span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{appConfig.appName}</h1>
          <div className="mt-4 h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
        </div>
      </main>
    );
  }

  if (status === 'network-error') {
    return (
      <main className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100 px-4">
        <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center text-center">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold text-slate-900">Unable to connect to server</h1>
            <p className="mt-2 text-sm text-slate-600">
              We couldn't complete the initial auth check. Please verify your connection and try
              again.
            </p>
            <button
              type="button"
              onClick={() => void runAuthCheck()}
              className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
