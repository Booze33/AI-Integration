'use client';

import Link from 'next/link';
import { appConfig } from '../lib/config';

interface ErrorFallbackProps {
  error?: Error | null;
  correlationId?: string | null;
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorFallback({
  error,
  correlationId,
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorFallbackProps) {
  const isDev = !appConfig.isProduction;
  const displayMessage = message
    ? message
    : isDev
      ? error?.message || 'Unknown render error'
      : 'An unexpected error occurred. Please try again.';

  return (
    <main className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100 px-4">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center text-center">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="mt-3 text-sm text-gray-600">{displayMessage}</p>
          {isDev && correlationId ? (
            <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
              Correlation ID: {correlationId}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRetry ?? (() => window.location.reload())}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Retry
            </button>
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
