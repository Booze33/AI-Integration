/**
 * API Client Layer
 *
 * Typed fetch wrappers with authentication, token refresh, and error handling.
 * One function per endpoint with full TypeScript support.
 */

// ============================================================================
// Types and Schemas
// ============================================================================

export interface User {
  id: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  role?: 'member' | 'admin';
}

export interface LoginResponse {
  message: string;
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RegisterResponse {
  message: string;
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface MeResponse {
  user: User;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

export interface TranscriptionResponse {
  text: string;
  confidence?: number;
}

export interface UploadResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  message: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantAIConfig {
  id: string;
  tenant_id: string;
  provider: string;
  api_key_encrypted: string;
  api_key_iv: string;
  base_url?: string;
  organization?: string;
  default_model?: string;
  default_voice_id?: string;
  timeout_ms?: number;
  max_retries?: number;
  is_active: boolean;
  metadata: Record<string, any>;
  created_by: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TenantConfigListResponse {
  success: boolean;
  data: TenantAIConfig[];
}

export interface TenantConfigResponse {
  success: boolean;
  data: TenantAIConfig;
}

export interface CreateTenantConfigRequest {
  provider: string;
  api_key: string;
  base_url?: string;
  organization?: string;
  default_model?: string;
  default_voice_id?: string;
  timeout_ms?: number;
  max_retries?: number;
  metadata?: Record<string, any>;
}

export type UpdateTenantConfigRequest = Partial<CreateTenantConfigRequest>;

export interface ProviderInfo {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
}

export interface ProvidersResponse {
  success: boolean;
  data: ProviderInfo[];
}

export interface ApiResponseError {
  error: string;
  message?: string;
  statusCode?: number;
}

// ============================================================================
// API Client Class
// ============================================================================

export class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<AuthTokens> | null = null;
  private mockMode: boolean;

  constructor(baseUrl: string = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
    this.loadTokens();
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  private loadTokens() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }
  }

  private saveTokens(tokens: AuthTokens) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
    }
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  private clearTokens() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    this.accessToken = null;
    this.refreshToken = null;
  }

  private async refreshAccessToken(): Promise<AuthTokens> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.isRefreshing = true;
    this.refreshPromise = this.request<RefreshResponse>('POST', '/auth/refresh', {
      headers: {
        Authorization: `Bearer ${this.refreshToken}`,
      },
    })
      .then((response) => {
        const tokens: AuthTokens = {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken || this.refreshToken!,
        };
        this.saveTokens(tokens);
        return tokens;
      })
      .finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  // ============================================================================
  // HTTP Request Methods
  // ============================================================================

  private async request<T>(
    method: string,
    endpoint: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
      params?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add authorization header if we have an access token
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (options.body && method !== 'GET') {
      requestOptions.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), requestOptions);
    } catch (error) {
      throw new ApiError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }

    // Handle token refresh on 401
    if (response.status === 401 && this.refreshToken && !endpoint.includes('/refresh')) {
      try {
        await this.refreshAccessToken();
        // Retry the request with new token
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url.toString(), { ...requestOptions, headers });
      } catch {
        this.clearTokens();
        throw new ApiError('Authentication failed', 401);
      }
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // Ignore JSON parsing errors
      }
      throw new ApiError(errorMessage, response.status);
    }

    // Handle empty responses
    if (response.status === 204) {
      return {} as T;
    }

    try {
      return await response.json();
    } catch {
      throw new ApiError('Invalid JSON response', response.status);
    }
  }

  // ============================================================================
  // Authentication Endpoints
  // ============================================================================

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    if (this.mockMode) {
      // Mock login response
      const mockResponse: LoginResponse = {
        message: 'Login successful',
        user: {
          id: 'mock-user-id',
          email: credentials.email,
          role: 'admin',
        },
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };
      this.saveTokens({
        accessToken: mockResponse.accessToken,
        refreshToken: mockResponse.refreshToken,
      });
      return mockResponse;
    }

    const response = await this.request<LoginResponse>('POST', '/auth/login', {
      body: credentials,
    });
    this.saveTokens({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    });
    return response;
  }

  async register(userData: RegisterRequest): Promise<RegisterResponse> {
    const response = await this.request<RegisterResponse>('POST', '/auth/register', {
      body: userData,
    });
    this.saveTokens({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    });
    return response;
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/auth/logout');
    } finally {
      this.clearTokens();
    }
  }

  async refresh(): Promise<RefreshResponse> {
    return this.refreshAccessToken().then((tokens) => ({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }));
  }

  async getCurrentUser(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/auth/me');
  }

  // ============================================================================
  // Chat Endpoints
  // ============================================================================

  async getChatHistory(): Promise<ChatHistoryResponse> {
    return this.request<ChatHistoryResponse>('GET', '/api/chat/history');
  }

  async transcribeAudio(audioBlob: Blob, sessionId?: string): Promise<TranscriptionResponse> {
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const headers: Record<string, string> = {};
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    return this.request<TranscriptionResponse>('POST', '/api/chat/transcribe', {
      body: formData,
      headers: {
        ...headers,
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  // ============================================================================
  // Pipeline Endpoints
  // ============================================================================

  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<UploadResponse>('POST', '/api/pipeline/upload', {
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return this.request<JobStatusResponse>('GET', `/api/pipeline/jobs/${jobId}`);
  }

  // ============================================================================
  // Tenant Configuration Endpoints
  // ============================================================================

  async getTenantConfigs(): Promise<TenantConfigListResponse> {
    if (this.mockMode) {
      // Mock tenant configs response
      return {
        success: true,
        data: [
          {
            id: 'mock-config-1',
            tenant_id: 'mock-tenant',
            provider: 'openai',
            api_key_encrypted: 'encrypted-key',
            api_key_iv: 'mock-iv',
            base_url: 'https://api.openai.com',
            default_model: 'gpt-4',
            timeout_ms: 30000,
            is_active: true,
            metadata: {},
            created_by: 'mock-user',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }

    return this.request<TenantConfigListResponse>('GET', '/api/tenant/config');
  }

  async getTenantConfig(id: string): Promise<TenantConfigResponse> {
    return this.request<TenantConfigResponse>('GET', `/api/tenant/config/${id}`);
  }

  async createTenantConfig(config: CreateTenantConfigRequest): Promise<TenantConfigResponse> {
    return this.request<TenantConfigResponse>('POST', '/api/tenant/config', {
      body: config,
    });
  }

  async updateTenantConfig(
    id: string,
    updates: UpdateTenantConfigRequest
  ): Promise<TenantConfigResponse> {
    return this.request<TenantConfigResponse>('PUT', `/api/tenant/config/${id}`, {
      body: updates,
    });
  }

  async deleteTenantConfig(id: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      'DELETE',
      `/api/tenant/config/${id}`
    );
  }

  async getProviders(): Promise<ProvidersResponse> {
    if (this.mockMode) {
      // Mock providers response
      return {
        success: true,
        data: [
          {
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
          },
          {
            name: 'anthropic',
            displayName: 'Anthropic',
            requiresApiKey: true,
          },
          {
            name: 'deepgram',
            displayName: 'Deepgram',
            requiresApiKey: true,
          },
          {
            name: 'elevenlabs',
            displayName: 'ElevenLabs',
            requiresApiKey: true,
          },
        ],
      };
    }

    return this.request<ProvidersResponse>('GET', '/api/tenant/providers');
  }
}

// ============================================================================
// Error Classes
// ============================================================================

export class ApiError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const apiClient = new ApiClient();

// ============================================================================
// React Hook for API Client
// ============================================================================

import { useState, useEffect, useCallback } from 'react';

export function useApiClient() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const response = await apiClient.getCurrentUser();
      setUser(response.user);
      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await apiClient.login(credentials);
    setUser(response.user);
    setIsAuthenticated(true);
    return response;
  }, []);

  const register = useCallback(async (userData: RegisterRequest) => {
    const response = await apiClient.register(userData);
    setUser(response.user);
    setIsAuthenticated(true);
    return response;
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  return {
    apiClient,
    isAuthenticated,
    user,
    isLoading,
    login,
    register,
    logout,
    checkAuth,
  };
}
