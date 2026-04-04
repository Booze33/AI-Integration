export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}
export interface TenantConfig {
  id: string;
  name: string;
  aiProvider: string;
  settings: Record<string, any>;
}
//# sourceMappingURL=index.d.ts.map
