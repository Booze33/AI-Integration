'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/upload', label: 'Files', icon: '📁' },
  { href: '/settings/general', label: 'Settings', icon: '⚙️' },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  if (pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/register')) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href === '/settings/general' && pathname.startsWith('/settings'));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium ${
                  isActive ? 'text-indigo-600' : 'text-slate-600'
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
