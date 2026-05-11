'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, User } from '../../../lib/api-client';
import { usePageTitle } from '../../../lib/usePageTitle';

export default function GeneralSettingsPage() {
  usePageTitle('Settings - General | AI Integration Platform');
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutSuccess, setLogoutSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient.getCurrentUser();
        setUser(response.user);
      } catch (err) {
        console.error('Failed to load account info:', err);
        setError(err instanceof Error ? err.message : 'Failed to load account information');
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const formatCreatedAt = (value?: string) => {
    if (!value) return 'Unavailable';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString();
  };

  const handleLogoutAllDevices = async () => {
    try {
      setLoggingOutAll(true);
      setError(null);
      setLogoutSuccess(null);
      await apiClient.logoutAllDevices();
      setLogoutSuccess('Logged out of all devices. Redirecting to sign in...');
      window.setTimeout(() => {
        router.push('/login');
      }, 700);
    } catch (err) {
      console.error('Failed to logout all devices:', err);
      setError(err instanceof Error ? err.message : 'Failed to logout all devices');
    } finally {
      setLoggingOutAll(false);
      setShowLogoutConfirmation(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:p-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Account Overview</h2>
          <p className="mt-1 text-sm text-gray-600">
            Profile editing coming soon. This page is read-only in v1.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          </div>
        ) : (
          <dl className="divide-y divide-gray-200 rounded-xl border border-gray-200">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm font-medium text-gray-600">Email</dt>
              <dd className="text-sm text-gray-900 break-all">{user?.email || 'Unavailable'}</dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm font-medium text-gray-600">User ID</dt>
              <dd className="text-sm text-gray-900 break-all">{user?.id || 'Unavailable'}</dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm font-medium text-gray-600">Tenant ID</dt>
              <dd className="text-sm text-gray-900 break-all">{user?.tenantId || 'Unavailable'}</dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm font-medium text-gray-600">Account Created</dt>
              <dd className="text-sm text-gray-900">{formatCreatedAt(user?.createdAt)}</dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <dt className="text-sm font-medium text-gray-600">Role</dt>
              <dd className="text-sm text-gray-900 capitalize">{user?.role || 'Unavailable'}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm lg:p-8">
        <h3 className="text-lg font-semibold text-red-900">Danger Zone</h3>
        <p className="mt-1 text-sm text-red-700">
          End all active sessions across devices. You will be signed out immediately.
        </p>

        {!showLogoutConfirmation ? (
          <button
            type="button"
            onClick={() => {
              setShowLogoutConfirmation(true);
              setLogoutSuccess(null);
            }}
            disabled={loggingOutAll}
            className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
          >
            Log out of all devices
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-red-200 bg-white p-4">
            <p className="text-sm font-medium text-red-800">Confirm logout from all devices?</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirmation(false)}
                disabled={loggingOutAll}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogoutAllDevices}
                disabled={loggingOutAll}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {loggingOutAll ? 'Logging out...' : 'Yes, log out all'}
              </button>
            </div>
          </div>
        )}

        {(error || logoutSuccess) && (
          <p className={`mt-4 text-sm ${error ? 'text-red-700' : 'text-green-700'}`}>
            {error || logoutSuccess}
          </p>
        )}
      </div>
    </div>
  );
}
