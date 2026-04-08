import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            AI Platform
          </h1>
          <nav className="hidden md:flex gap-6">
            <Link href="#features" className="text-gray-600 hover:text-blue-600 transition-colors">
              Features
            </Link>
            <Link href="/login" className="text-gray-600 hover:text-blue-600 transition-colors">
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20 md:py-32">
        <div className="text-center space-y-8 animate-fadeIn">
          <div className="space-y-4">
            <h2 className="text-5xl md:text-7xl font-bold text-gray-900 leading-tight">
              AI Integration{' '}
              <span className="text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text">
                Platform
              </span>
            </h2>
            <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              A powerful platform for integrating AI capabilities into your applications. Built with
              Next.js, TypeScript, and shared type definitions for seamless development.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col md:flex-row gap-4 justify-center pt-6">
            <Link
              href="/login"
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg font-semibold transition-all transform hover:scale-105 shadow-lg hover:shadow-xl"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="px-8 py-4 bg-white hover:bg-gray-50 text-blue-600 rounded-lg font-semibold border-2 border-blue-600 transition-all transform hover:scale-105 shadow-md"
            >
              Sign Up
            </Link>
            <Link
              href="/chat"
              className="px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg font-semibold transition-all transform hover:scale-105 shadow-lg hover:shadow-xl"
            >
              Try Chat
            </Link>
          </div>

          {/* Feature Highlights */}
          <div className="grid md:grid-cols-3 gap-6 pt-12">
            {[
              {
                icon: '⚡',
                title: 'Lightning Fast',
                desc: 'Built for performance with streaming capabilities',
              },
              {
                icon: '🔒',
                title: 'Secure',
                desc: 'Enterprise-grade security with JWT authentication',
              },
              {
                icon: '📊',
                title: 'Scalable',
                desc: 'Multi-tenant architecture ready for scale',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="bg-white/80 backdrop-blur p-6 rounded-xl border border-gray-200/50 hover:border-blue-300 transition-colors shadow-sm hover:shadow-md"
              >
                <div className="text-4xl mb-3">{feature.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 mt-20 border-t border-gray-800">
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-sm">© 2024 AI Integration Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
