'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SETTINGS_NAV_ITEMS = [
  {
    href: '/settings/general',
    label: 'General',
    description: 'App and profile defaults',
  },
  {
    href: '/settings/ai-providers',
    label: 'AI Providers',
    description: 'Keys and model setup',
  },
  {
    href: '/settings/active-sessions',
    label: 'Active Sessions',
    description: 'Current login sessions',
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 via-white to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage your workspace preferences, AI providers, and account sessions.
          </p>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm md:hidden">
          {SETTINGS_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="grid gap-6 md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr]">
          <aside className="hidden md:block">
            <nav className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              {SETTINGS_NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-xl px-4 py-3 transition-colors ${
                      isActive
                        ? 'bg-blue-50 ring-1 ring-blue-200'
                        : 'hover:bg-gray-50 focus-visible:bg-gray-50'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-900'}`}
                    >
                      {item.label}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{item.description}</p>
                  </Link>
                );
              })}
            </nav>
          </aside>

          <section>{children}</section>
        </div>
      </div>
    </div>
  );
}
