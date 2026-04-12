'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, DashboardStats } from '../../lib/api-client';

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

  useEffect(() => {
    async function fetchDashboardStats() {
      if (!user) return;

      try {
        // Use the API client to fetch dashboard stats
        const response = await apiClient.getDashboardStats();
        if (response.success) {
          setStats(response.stats);
          setStatsError(null);
        } else {
          throw new Error('Failed to fetch stats');
        }
      } catch (error: any) {
        console.error('Failed to fetch dashboard stats:', error);
        setStatsError(error.message || 'Failed to load dashboard statistics');

        // Use fallback mock stats when API is not available
        setStats({
          totalChats: 12,
          filesUploaded: 8,
          tokensUsed: 2500,
          apiCalls: 156,
          queueStats: {
            waiting: 2,
            active: 1,
            completed: 45,
            failed: 3,
            delayed: 0,
          },
        });
      } finally {
        setStatsLoading(false);
      }
    }

    if (user) {
      fetchDashboardStats();
    }
  }, [user]);

  const handleLogout = async () => {
    try {
      await apiClient.logout();
    } finally {
      router.push('/login');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
          <p className="text-gray-600 font-medium">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const statCards = [
    {
      label: 'Total Chats',
      value: stats?.totalChats?.toString() || '0',
      icon: '💬',
      color: 'blue',
    },
    {
      label: 'Files Uploaded',
      value: stats?.filesUploaded?.toString() || '0',
      icon: '📁',
      color: 'purple',
    },
    {
      label: 'Tokens Used',
      value: stats?.tokensUsed?.toLocaleString() || '0',
      icon: '🔑',
      color: 'green',
    },
    {
      label: 'API Calls',
      value: stats?.apiCalls?.toLocaleString() || '0',
      icon: '🔄',
      color: 'orange',
    },
  ];

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
        {statsError && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">
              ⚠️ Using demo data: {statsError}. Start using the app to see real statistics!
            </p>
          </div>
        )}

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

        {/* Stats Section */}
        <div className="grid md:grid-cols-4 gap-4 mt-12">
          {statCards.map((stat, i) => (
            <div
              key={i}
              className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow`}
            >
              <p className="text-3xl mb-2">{stat.icon}</p>
              <p className="text-gray-600 text-sm font-medium">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {statsLoading ? (
                  <div className="h-8 w-16 bg-gray-200 rounded animate-pulse"></div>
                ) : (
                  stat.value
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Queue Stats Section */}
        {stats?.queueStats && (
          <div className="mt-12">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Queue Statistics</h3>
            <div className="grid md:grid-cols-5 gap-4">
              {[
                { label: 'Waiting', value: stats.queueStats.waiting, color: 'yellow' },
                { label: 'Active', value: stats.queueStats.active, color: 'blue' },
                { label: 'Completed', value: stats.queueStats.completed, color: 'green' },
                { label: 'Failed', value: stats.queueStats.failed, color: 'red' },
                { label: 'Delayed', value: stats.queueStats.delayed, color: 'orange' },
              ].map((queueStat, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <p className="text-gray-600 text-sm font-medium">{queueStat.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{queueStat.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
