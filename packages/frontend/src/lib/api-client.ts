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
// Dashboard Stats Types
// ============================================================================

export interface DashboardStats {
  totalChats: number;
  filesUploaded: number;
  tokensUsed: number;
  apiCalls: number;
  queueStats?: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export interface DashboardStatsResponse {
  success: boolean;
  stats: DashboardStats;
}

// ============================================================================
// API Client Class
// ============================================================================

export class ApiClient {
  private baseUrl: string;
  private mockMode: boolean;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
    this.mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
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
    const url = new URL(endpoint, this.baseUrl || window.location.origin);

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

    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include', // Include cookies for authentication
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
      return mockResponse;
    }

    const response = await this.request<LoginResponse>('POST', '/api/auth/login', {
      body: credentials,
    });
    return response;
  }

  async register(userData: RegisterRequest): Promise<RegisterResponse> {
    console.log('Registering user with data:', this.baseUrl);
    const response = await this.request<RegisterResponse>('POST', '/api/auth/register', {
      body: userData,
    });
    return response;
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/auth/logout');
    } catch (error) {
      // Logout should succeed even if the server request fails
      console.error('Logout error:', error);
    }
  }

  async getCurrentUser(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/api/auth/me');
  }

  // ============================================================================
  // Chat Endpoints
  // ============================================================================

  async getChatHistory(): Promise<ChatHistoryResponse> {
    return this.request<ChatHistoryResponse>('GET', '/api/chat/history');
  }

  async saveChatHistory(messages: ChatMessage[], streamId?: string): Promise<void> {
    await this.request('POST', '/api/chat/history', {
      body: { messages, streamId },
    });
  }

  async startTranscriptionSession(): Promise<{ sessionId: string }> {
    const response = await this.request<{ sessionId: string }>('GET', '/api/chat/transcribe');
    return response;
  }

  async sendAudioChunk(sessionId: string, audioData: ArrayBuffer): Promise<void> {
    await this.request('POST', `/api/chat/transcribe/${sessionId}`, {
      body: audioData,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    });
  }

  async closeTranscriptionSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/api/chat/transcribe/${sessionId}`);
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

  // ============================================================================
  // Dashboard Endpoints
  // ============================================================================

  async getDashboardStats(): Promise<DashboardStatsResponse> {
    if (this.mockMode) {
      // Mock dashboard stats response
      return {
        success: true,
        stats: {
          totalChats: 12,
          filesUploaded: 8,
          tokensUsed: 2500,
          apiCalls: 156,
          queueStats: {
            waiting: 2,
            active: 1,
            completed: 45,
            failed: 3,
            delayed: 0,
          },
        },
      };
    }

    return this.request<DashboardStatsResponse>('GET', '/api/dashboard/stats');
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
