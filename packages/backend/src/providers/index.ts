/**
 * AI Providers Module
 *
 * This module provides a unified interface for interacting with various AI providers.
 * Switch between providers by setting the AI_PROVIDER environment variable.
 *
 * @example
 * ```typescript
 * import { getProvider } from './providers';
 *
 * // Get the configured provider
 * const ai = getProvider();
 *
 * // Use the provider
 * const response = await ai.chat([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * ```
 */

// Export types
export type {
  AIProvider,
  ProviderConfig,
  ProviderName,
  ProviderFactoryConfig,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamChunk,
  TranscribeOptions,
  TranscribeResponse,
  SpeakOptions,
  SpeakResponse,
  EmbedOptions,
  EmbedResponse,
  EmbedBatchOptions,
  EmbedBatchResponse,
} from './types';

// Export factory functions
export {
  createProvider,
  createProviderFromEnv,
  getProvider,
  getProviderForTenant,
  createProviderForTenant,
  resetProvider,
  resetTenantProviders,
  getCachedProviderForTenant,
  registerProvider,
  getAvailableProviders,
  validateProviderConfig,
} from './factory';

// Export tenant configuration utilities
export {
  TenantAIConfigService,
  InMemoryTenantAIConfigRepository,
  createTenantAIConfigService,
} from './tenant-config';

export type {
  TenantAIConfig,
  TenantAIConfigInput,
  TenantAIConfigRepository,
} from './tenant-config';

// Import implementations to register providers
import './implementations';

// Re-export provider implementations
export { OpenAIProvider } from './implementations/openai';
export { AnthropicProvider } from './implementations/anthropic';
export { DeepgramProvider } from './implementations/deepgram';
export { ElevenLabsProvider } from './implementations/elevenlabs';

// Re-export error types
export { ProviderError, RateLimitError, TokenLimitError } from './implementations/openai';

export {
  AnthropicProviderError,
  AnthropicRateLimitError,
  AnthropicOverloadedError,
} from './implementations/anthropic';

export { DeepgramProviderError, DeepgramRateLimitError } from './implementations/deepgram';

export { ElevenLabsProviderError, ElevenLabsRateLimitError } from './implementations/elevenlabs';
