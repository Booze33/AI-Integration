'use client';

import { useEffect } from 'react';
import { ErrorFallback } from '../components/ErrorFallback';
import { getLastFailedRequestCorrelationId } from '../lib/api-client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global app error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorFallback
          error={error}
          correlationId={getLastFailedRequestCorrelationId()}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
