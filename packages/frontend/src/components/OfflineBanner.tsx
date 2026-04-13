'use client';

import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const syncOnlineStatus = () => {
      setIsOffline(!navigator.onLine);
    };

    syncOnlineStatus();
    window.addEventListener('offline', syncOnlineStatus);
    window.addEventListener('online', syncOnlineStatus);

    return () => {
      window.removeEventListener('offline', syncOnlineStatus);
      window.removeEventListener('online', syncOnlineStatus);
    };
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-0 z-100">
      <div className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950 shadow">
        You're offline. Some features may be unavailable.
      </div>
    </div>
  );
}
