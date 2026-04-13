import Link from 'next/link';
import { ReactNode } from 'react';

interface AuthPageShellProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  accentClasses: string;
  switchPrompt: string;
  switchHref: string;
  switchLabel: string;
  footer: ReactNode;
  children: ReactNode;
}

export default function AuthPageShell({
  icon,
  title,
  subtitle,
  accentClasses,
  switchPrompt,
  switchHref,
  switchLabel,
  footer,
  children,
}: AuthPageShellProps) {
  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6 border border-gray-100 animate-slideIn">
          <div className="space-y-2">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${accentClasses}`}
            >
              <span className="text-xl font-bold text-white">{icon}</span>
            </div>
            <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
            <p className="text-gray-600">{subtitle}</p>
          </div>

          {children}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">{switchPrompt}</span>
            </div>
          </div>

          <Link
            href={switchHref}
            className="w-full py-3 px-4 border-2 border-blue-600 text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition-colors text-center block"
          >
            {switchLabel}
          </Link>

          {footer}
        </div>
      </div>
    </div>
  );
}
