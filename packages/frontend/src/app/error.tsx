'use client';

import { useEffect } from 'react';
import { ErrorFallback } from '../components/ErrorFallback';
import { getLastFailedRequestCorrelationId } from '../lib/api-client';

export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App route error:', error);
  }, [error]);

  return (
    <ErrorFallback
      error={error}
      correlationId={getLastFailedRequestCorrelationId()}
      onRetry={reset}
    />
  );
}
