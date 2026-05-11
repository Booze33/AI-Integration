'use client';

import React from 'react';
import { ErrorFallback } from './ErrorFallback';
import { getLastFailedRequestCorrelationId } from '../lib/api-client';

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

    return (
      <ErrorFallback
        error={this.state.error}
        correlationId={getLastFailedRequestCorrelationId()}
        onRetry={() => window.location.reload()}
      />
    );
  }
}
