/**
 * API Client Unit Tests
 *
 * Tests for the typed API client with authentication, token refresh, and error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiClient, ApiError } from '../api-client';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });

    client = new ApiClient('http://test-api.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    it('should login successfully', async () => {
      const mockResponse = {
        message: 'Login successful',
        user: { id: '1', email: 'test@example.com', role: 'admin' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test-api.com/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password',
          }),
        })
      );
    });

    it('should handle login failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      await expect(
        client.login({
          email: 'test@example.com',
          password: 'wrong-password',
        })
      ).rejects.toThrow(ApiError);
    });
  });

  describe('Tenant Configuration', () => {
    it('should get tenant configurations', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: '1',
            provider: 'openai',
            api_key_encrypted: '••••••••',
            base_url: null,
            is_active: true,
          },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getTenantConfigs();

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test-api.com/api/tenant/config',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
        })
      );
    });

    it('should create tenant configuration', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: '1',
          provider: 'openai',
          api_key_encrypted: '••••••••',
          is_active: true,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const config = {
        provider: 'openai' as const,
        api_key: 'sk-test123',
      };

      const result = await client.createTenantConfig(config);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test-api.com/api/tenant/config',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(config),
        })
      );
    });

    it('should update tenant configuration', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: '1',
          provider: 'openai',
          api_key_encrypted: '••••••••',
          base_url: 'https://api.openai.com',
          is_active: true,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const updates = {
        base_url: 'https://api.openai.com',
      };

      const result = await client.updateTenantConfig('1', updates);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test-api.com/api/tenant/config/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(updates),
        })
      );
    });

    it('should delete tenant configuration', async () => {
      const mockResponse = {
        success: true,
        message: 'Configuration deactivated successfully',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.deleteTenantConfig('1');

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test-api.com/api/tenant/config/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw ApiError on HTTP errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad Request' }),
      });

      await expect(client.getCurrentUser()).rejects.toThrow(ApiError);
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getCurrentUser()).rejects.toThrow(ApiError);
    });

    it('should handle invalid JSON responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(client.getCurrentUser()).rejects.toThrow(ApiError);
    });
  });
});
