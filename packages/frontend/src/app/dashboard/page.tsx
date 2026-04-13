'use client';

import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, DashboardStats } from '../../lib/api-client';
import { getCachedDashboardStats, setCachedDashboardStats } from '../../lib/dashboard-store';

interface User {
  id: string;
  email: string;
  role: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await apiClient.getCurrentUser();
        setUser(response.user);
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, [router]);

  const loadDashboardStats = useCallback(
    async (forceRefetch = false) => {
      if (!user) return;

      setStatsLoading(true);
      setStatsError(null);

      if (!forceRefetch) {
        const cachedStats = getCachedDashboardStats();
        if (cachedStats) {
          setStats(cachedStats);
          setStatsLoading(false);
          return;
        }
      }

      try {
        const response = await apiClient.getDashboardStats();
        if (!response.success) {
          throw new Error('Failed to fetch stats');
        }

        setStats(response.stats);
        setCachedDashboardStats(response.stats);
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
        setStats(null);
        setStatsError(error instanceof Error ? error.message : 'Failed to fetch dashboard stats');
      } finally {
        setStatsLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) {
      // Queue/stat values are fetched once on mount; polling is intentionally disabled.
      loadDashboardStats();
    }
  }, [user, loadDashboardStats]);

  const handleLogout = async () => {
    try {
      await apiClient.logout();
    } finally {
      router.push('/login');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
              <div className="h-9 w-72 rounded-lg skeleton-shimmer"></div>
              <div className="h-4 w-56 rounded skeleton-shimmer"></div>
              <div className="grid md:grid-cols-3 gap-4 pt-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-6 space-y-3">
                    <div className="h-3 w-20 rounded skeleton-shimmer"></div>
                    <div className="h-4 w-full rounded skeleton-shimmer"></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-3">
                <div className="h-5 w-28 rounded skeleton-shimmer"></div>
                <div className="h-10 w-full rounded-lg skeleton-shimmer"></div>
                <div className="h-10 w-full rounded-lg skeleton-shimmer"></div>
                <div className="h-10 w-full rounded-lg skeleton-shimmer"></div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4 mt-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-8 w-8 rounded skeleton-shimmer"></div>
                <div className="h-4 w-28 rounded mt-3 skeleton-shimmer"></div>
                <div className="h-8 w-20 rounded mt-3 skeleton-shimmer"></div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const statCards = stats
    ? [
        {
          label: 'Total Chats',
          value: stats.totalChats,
          icon: '💬',
        },
        {
          label: 'Files Uploaded',
          value: stats.filesUploaded,
          icon: '📁',
        },
        {
          label: 'Tokens Used (estimated)',
          value: stats.tokensUsed,
          icon: '🔑',
        },
        {
          label: 'API Calls',
          value: stats.apiCalls,
          icon: '🔄',
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-linear-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">A</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            </div>
            <button
              onClick={handleLogout}
              className="px-6 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 rounded-lg font-medium transition-colors border border-red-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-3 gap-8">
          {/* User Info Card */}
          <div className="md:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                  Welcome, {user.email.split('@')[0]}! 👋
                </h2>
                <p className="text-gray-600">Here's an overview of your account</p>
              </div>

              <div className="grid md:grid-cols-3 gap-4 pt-4">
                <div className="bg-linear-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                  <p className="text-blue-600 font-semibold text-sm mb-2">📧 Email</p>
                  <p className="text-gray-900 font-mono text-sm break-all">{user.email}</p>
                </div>
                <div className="bg-linear-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
                  <p className="text-purple-600 font-semibold text-sm mb-2">👤 Role</p>
                  <p className="text-gray-900 font-mono text-sm capitalize">{user.role}</p>
                </div>
                <div className="bg-linear-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
                  <p className="text-green-600 font-semibold text-sm mb-2">🆔 User ID</p>
                  <p className="text-gray-900 font-mono text-sm truncate">
                    {user.id.substring(0, 12)}...
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <a
                  href="/chat"
                  className="block px-4 py-3 bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg font-medium text-center transition-all transform hover:scale-105"
                >
                  💬 Start Chat
                </a>
                <a
                  href="/upload"
                  className="block px-4 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg font-medium text-center transition-all transform hover:scale-105"
                >
                  📤 Upload File
                </a>
                <a
                  href="/settings"
                  className="block px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-lg font-medium text-center transition-colors"
                >
                  ⚙️ Settings
                </a>
              </div>
            </div>
          </div>
        </div>

        {statsError && !statsLoading && (
          <div className="mt-12 rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-red-700">
              Failed to load dashboard stats. Please try again.
            </p>
            <button
              type="button"
              onClick={() => loadDashboardStats(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Stats Section */}
        {statsLoading ? (
          <div className="grid md:grid-cols-4 gap-4 mt-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-8 w-8 rounded skeleton-shimmer"></div>
                <div className="h-4 w-28 rounded mt-3 skeleton-shimmer"></div>
                <div className="h-8 w-20 rounded mt-3 skeleton-shimmer"></div>
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid md:grid-cols-4 gap-4 mt-12">
            {statCards.map((stat, i) => (
              <div
                key={i}
                className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow`}
              >
                <p className="text-3xl mb-2">{stat.icon}</p>
                <p className="text-gray-600 text-sm font-medium">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  <span
                    className="stat-count-up"
                    style={{ '--count-target': stat.value } as CSSProperties}
                  />
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Queue Stats Section */}
        {statsLoading ? (
          <div className="mt-12">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Queue Statistics</h3>
            <div className="flex flex-wrap items-center gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5"
                >
                  <div className="h-3 w-14 rounded skeleton-shimmer"></div>
                  <div className="h-3 w-6 rounded skeleton-shimmer"></div>
                </div>
              ))}
            </div>
          </div>
        ) : stats?.queueStats ? (
          <div className="mt-12">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Queue Statistics</h3>
            <div className="flex flex-wrap items-center gap-3">
              {[
                { label: 'Waiting', value: stats.queueStats.waiting },
                { label: 'Active', value: stats.queueStats.active },
                { label: 'Completed', value: stats.queueStats.completed },
                { label: 'Failed', value: stats.queueStats.failed },
                { label: 'Delayed', value: stats.queueStats.delayed },
              ].map((queueStat, i) => (
                <div
                  key={i}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                    queueStat.label === 'Failed' && queueStat.value > 0
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-gray-200 bg-white text-gray-700'
                  } ${queueStat.label === 'Active' && queueStat.value > 0 ? 'animate-pulse' : ''}`}
                >
                  <span className="font-medium">{queueStat.label}</span>
                  <span className="font-bold tabular-nums">{queueStat.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
