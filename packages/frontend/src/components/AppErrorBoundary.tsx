'use client';

import Link from 'next/link';
import React from 'react';
import { getLastFailedRequestCorrelationId } from '../lib/api-client';
import { appConfig } from '../lib/config';

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const correlationId = getLastFailedRequestCorrelationId();
    console.error('Unhandled render error:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      correlationId: correlationId || undefined,
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isDev = !appConfig.isProduction;
    const displayMessage = isDev
      ? this.state.error?.message || 'Unknown render error'
      : 'An unexpected error occurred. Please try again.';

    return (
      <main className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100 px-4">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center text-center">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-3xl font-bold text-gray-900">Something went wrong</h1>
            <p className="mt-3 text-sm text-gray-600">{displayMessage}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Reload page
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
}
