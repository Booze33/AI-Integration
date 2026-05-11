import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { AuthBootstrap } from '../components/AuthBootstrap';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { OfflineBanner } from '../components/OfflineBanner';
import { ToastProvider } from '../components/toast/ToastProvider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AI Integration Platform',
  description: 'A powerful platform for integrating AI capabilities into your applications',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} scroll-smooth`}>
      <body className="bg-white text-gray-900 antialiased overflow-x-hidden pb-16 md:pb-0">
        <AppErrorBoundary>
          <AuthBootstrap>
            <ToastProvider>{children}</ToastProvider>
            <OfflineBanner />
            <MobileBottomNav />
          </AuthBootstrap>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
