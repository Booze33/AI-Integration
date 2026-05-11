'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiClient } from '../../../lib/api-client';
import { useToast } from '../../../components/toast/ToastProvider';
import { usePageTitle } from '../../../lib/usePageTitle';

export default function ActiveSessionsPage() {
  usePageTitle('Settings - Active Sessions | AI Integration Platform');
  const { showToast } = useToast();
  const [tokenIds, setTokenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [confirmingTokenId, setConfirmingTokenId] = useState<string | null>(null);

  useEffect(() => {
    async function loadActiveTokens() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient.getActiveTokens();
        setTokenIds(response.tokens);
      } catch (err) {
        console.error('Failed to load active sessions:', err);
        setError(err instanceof Error ? err.message : 'Failed to load active sessions');
      } finally {
        setLoading(false);
      }
    }

    loadActiveTokens();
  }, []);

  const truncateTokenId = (tokenId: string) => `${tokenId.slice(0, 12)}...`;

  const handleCopyToken = async (tokenId: string) => {
    try {
      await navigator.clipboard.writeText(tokenId);
      setCopiedTokenId(tokenId);
      window.setTimeout(() => {
        setCopiedTokenId((current) => (current === tokenId ? null : current));
      }, 1200);
    } catch (err) {
      console.error('Failed to copy token ID:', err);
      setError('Failed to copy token ID');
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    const previousIds = tokenIds;
    setConfirmingTokenId(null);
    setRevoking((prev) => ({ ...prev, [tokenId]: true }));
    setError(null);

    // Optimistically remove from list immediately.
    setTokenIds((prev) => prev.filter((id) => id !== tokenId));

    try {
      await apiClient.revokeToken(tokenId);
      showToast('Session token revoked successfully.', 'success');
    } catch (err) {
      console.error('Failed to revoke token:', err);
      setTokenIds(previousIds);
      if (err instanceof ApiError && err.statusCode === 401) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : 'Network error while revoking session token.'
        );
        showToast('Network error while revoking session token.', 'error');
      }
    } finally {
      setRevoking((prev) => {
        const next = { ...prev };
        delete next[tokenId];
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:p-8">
        <h2 className="text-xl font-semibold text-gray-900">Active Sessions</h2>
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Warning: if you revoke the token for your current session, your next API request will
          return 401 and you will be logged out automatically.
        </p>
        <p className="mt-3 text-sm text-gray-600">{tokenIds.length} active session(s).</p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="h-5 w-44 rounded skeleton-shimmer"></div>
                <div className="h-8 w-20 rounded-md skeleton-shimmer"></div>
              </div>
            ))}
          </div>
        ) : tokenIds.length === 0 ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              🔐
            </div>
            <p className="text-sm font-semibold text-gray-900">No active sessions found.</p>
            <p className="mt-1 text-xs text-gray-500">
              New sessions will appear here after you sign in on another device.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {tokenIds.map((tokenId) => (
              <li
                key={tokenId}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <p className="text-sm font-mono font-medium text-gray-900">
                    {truncateTokenId(tokenId)}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyToken(tokenId)}
                    className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {copiedTokenId === tokenId ? 'Copied' : 'Copy'}
                  </button>
                </div>

                {confirmingTokenId === tokenId ? (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm">
                    <span className="text-amber-900">Revoke this session?</span>
                    <button
                      type="button"
                      onClick={() => handleRevokeToken(tokenId)}
                      disabled={!!revoking[tokenId]}
                      className="inline-flex min-h-11 items-center rounded-md px-3 py-2 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                    >
                      {revoking[tokenId] ? 'Revoking...' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingTokenId(null)}
                      disabled={!!revoking[tokenId]}
                      className="inline-flex min-h-11 items-center rounded-md px-3 py-2 font-semibold text-slate-700 hover:bg-white disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingTokenId(tokenId)}
                    disabled={!!revoking[tokenId]}
                    className="min-h-11 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
