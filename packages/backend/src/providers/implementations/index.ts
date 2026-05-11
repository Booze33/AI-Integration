/**
 * Provider Implementations
 *
 * Register all provider implementations here.
 * The factory will use these registrations to create provider instances.
 */

import { registerProvider } from '../factory';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { DeepgramProvider } from './deepgram';
import { ElevenLabsProvider } from './elevenlabs';

// Register providers
registerProvider('openai', OpenAIProvider);
registerProvider('anthropic', AnthropicProvider);
registerProvider('deepgram', DeepgramProvider);
registerProvider('elevenlabs', ElevenLabsProvider);

// Export provider implementations
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { DeepgramProvider } from './deepgram';
export { ElevenLabsProvider } from './elevenlabs';

// Export error types for error handling
export { ProviderError, RateLimitError, TokenLimitError } from './openai';

export {
  AnthropicProviderError,
  AnthropicRateLimitError,
  AnthropicOverloadedError,
} from './anthropic';

export { DeepgramProviderError, DeepgramRateLimitError } from './deepgram';

export { ElevenLabsProviderError, ElevenLabsRateLimitError } from './elevenlabs';
