import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            AI Integration Platform
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            A powerful platform for integrating AI capabilities into your applications. Built with
            Next.js, TypeScript, and shared type definitions.
          </p>
          <div className="space-x-4">
            <Link
              href="/login"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-medium transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-white hover:bg-gray-50 text-indigo-600 px-8 py-3 rounded-lg font-medium border border-indigo-600 transition-colors"
            >
              Sign Up
            </Link>
            <Link
              href="/chat"
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium transition-colors"
            >
              Start Streaming Chat
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
