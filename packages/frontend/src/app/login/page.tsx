'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthPageShell from '../../components/auth/AuthPageShell';
import { apiClient, ApiError, LoginRequest } from '../../lib/api-client';
import { resolvePostLoginRedirect } from '../../lib/auth-redirect';
import { usePageTitle } from '../../lib/usePageTitle';

interface LoginFormData {
  email: string;
  password: string;
}

export default function LoginPage() {
  usePageTitle('Sign In | AI Integration Platform');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState<LoginFormData>({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<LoginFormData>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string>('');

  const validateForm = (): boolean => {
    const newErrors: Partial<LoginFormData> = {};

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const credentials: LoginRequest = {
        email: formData.email,
        password: formData.password,
      };

      await apiClient.login(credentials);
      router.replace(resolvePostLoginRedirect(searchParams.get('redirect')));
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        setApiError('Invalid email or password');
      } else {
        setApiError(error instanceof Error ? error.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user starts typing

    if (errors[name as keyof LoginFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <AuthPageShell
      icon="🤖"
      title="Welcome Back"
      subtitle="Sign in to your AI platform account"
      accentClasses="bg-linear-to-br from-blue-600 to-indigo-600"
      switchPrompt="New to AI Platform?"
      switchHref="/register"
      switchLabel="Create an Account"
      footer={
        <p className="text-center text-gray-600 text-sm mt-6">
          By signing in, you agree to our{' '}
          <Link href="#" className="text-blue-600 hover:text-blue-700 font-medium">
            Terms of Service
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {/* Email Input */}
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={`w-full px-4 py-3 border-2 rounded-lg transition-colors placeholder-gray-400 focus:outline-none ${
              errors.email
                ? 'border-red-300 focus:border-red-500 bg-red-50'
                : 'border-gray-200 focus:border-blue-500 bg-gray-50'
            }`}
            placeholder="you@example.com"
            value={formData.email}
            onChange={handleChange}
          />
          {errors.email && <p className="text-sm text-red-600 font-medium">{errors.email}</p>}
        </div>

        {/* Password Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <Link href="#" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={`w-full px-4 py-3 border-2 rounded-lg transition-colors placeholder-gray-400 focus:outline-none ${
              errors.password
                ? 'border-red-300 focus:border-red-500 bg-red-50'
                : 'border-gray-200 focus:border-blue-500 bg-gray-50'
            }`}
            placeholder="••••••••"
            value={formData.password}
            onChange={handleChange}
          />
          {errors.password && <p className="text-sm text-red-600 font-medium">{errors.password}</p>}
        </div>

        {/* Error Alert */}
        {apiError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700 font-medium">❌ {apiError}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-4 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl mt-2"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Signing in...
            </span>
          ) : (
            'Sign In'
          )}
        </button>
      </form>
    </AuthPageShell>
  );
}
