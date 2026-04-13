'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthPageShell from '../../components/auth/AuthPageShell';
import { apiClient, RegisterRequest } from '../../lib/api-client';

interface RegisterFormData {
  email: string;
  password: string;
  confirmPassword: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<RegisterFormData>({
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<RegisterFormData>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string>('');

  const validateForm = (): boolean => {
    const newErrors: Partial<RegisterFormData> = {};

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters long';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
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
      const userData: RegisterRequest = {
        email: formData.email,
        password: formData.password,
      };

      await apiClient.register(userData);
      router.push('/dashboard');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user starts typing
    if (errors[name as keyof RegisterFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <AuthPageShell
      icon="🚀"
      title="Create Account"
      subtitle="Join the AI platform to get started"
      accentClasses="bg-linear-to-br from-green-500 to-emerald-600"
      switchPrompt="Already have an account?"
      switchHref="/login"
      switchLabel="Sign In Instead"
      footer={
        <p className="text-center text-gray-600 text-sm mt-6">
          By creating an account, you agree to our{' '}
          <Link href="#" className="text-blue-600 hover:text-blue-700 font-medium">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="#" className="text-blue-600 hover:text-blue-700 font-medium">
            Privacy Policy
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
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className={`w-full px-4 py-3 border-2 rounded-lg transition-colors placeholder-gray-400 focus:outline-none ${
              errors.password
                ? 'border-red-300 focus:border-red-500 bg-red-50'
                : 'border-gray-200 focus:border-blue-500 bg-gray-50'
            }`}
            placeholder="•••••••• (min 8 characters)"
            value={formData.password}
            onChange={handleChange}
          />
          {errors.password && <p className="text-sm text-red-600 font-medium">{errors.password}</p>}
        </div>

        {/* Confirm Password Input */}
        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className={`w-full px-4 py-3 border-2 rounded-lg transition-colors placeholder-gray-400 focus:outline-none ${
              errors.confirmPassword
                ? 'border-red-300 focus:border-red-500 bg-red-50'
                : 'border-gray-200 focus:border-blue-500 bg-gray-50'
            }`}
            placeholder="••••••••"
            value={formData.confirmPassword}
            onChange={handleChange}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-red-600 font-medium">{errors.confirmPassword}</p>
          )}
        </div>

        {/* Error Alert */}
        {apiError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700 font-medium">❌ {apiError}</p>
          </div>
        )}

        {/* Password Requirements */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm font-medium text-blue-800 mb-1">Password Requirements:</p>
          <ul className="text-xs text-blue-700 space-y-1">
            <li className="flex items-center">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${formData.password.length >= 8 ? 'bg-green-500' : 'bg-gray-300'}`}
              ></span>
              At least 8 characters
            </li>
            <li className="flex items-center">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${/[A-Z]/.test(formData.password) ? 'bg-green-500' : 'bg-gray-300'}`}
              ></span>
              Contains uppercase letter
            </li>
            <li className="flex items-center">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${/[a-z]/.test(formData.password) ? 'bg-green-500' : 'bg-gray-300'}`}
              ></span>
              Contains lowercase letter
            </li>
            <li className="flex items-center">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${/\d/.test(formData.password) ? 'bg-green-500' : 'bg-gray-300'}`}
              ></span>
              Contains number
            </li>
          </ul>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-4 bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl mt-2"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Creating account...
            </span>
          ) : (
            'Create Account'
          )}
        </button>
      </form>
    </AuthPageShell>
  );
}
