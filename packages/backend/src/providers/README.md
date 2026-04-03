# AI Providers Module

This module provides a unified interface for interacting with various AI providers. Switching between providers is as simple as changing one environment variable.

## Features

- **Unified Interface**: Single `AIProvider` interface for all AI services
- **Easy Switching**: Change providers with `ACTIVE_AI_PROVIDER` environment variable
- **Type Safety**: Full TypeScript support with comprehensive types
- **Extensible**: Easy to add new provider implementations
- **Error Handling**: Structured error types for different failure scenarios
- **Retry Logic**: Built-in exponential backoff with configurable retries
- **Per-Tenant Config**: Support for tenant-specific API keys and configurations

## Supported Providers

| Provider   | Chat | Transcribe | Speak | Embed | Notes                                 |
| ---------- | ---- | ---------- | ----- | ----- | ------------------------------------- |
| OpenAI     | ✅   | ✅         | ✅    | ✅    | GPT-4o, Whisper, TTS, Embeddings      |
| Anthropic  | ✅   | ❌         | ❌    | ❌    | Claude 3.5 Sonnet/Haiku, Claude 3     |
| Deepgram   | ❌   | ✅         | ❌    | ❌    | Nova-2, real-time WebSocket streaming |
| ElevenLabs | ❌   | ❌         | ✅    | ❌    | Multiple voices, voice settings       |

## Quick Start

### 1. Configure Environment Variables

Add to your `.env` file:

```env
# Choose your provider (openai | anthropic | deepgram | elevenlabs)
ACTIVE_AI_PROVIDER=openai

# Set your API key
AI_API_KEY=sk-your-api-key-here

# Optional: Custom base URL (useful for proxies or self-hosted)
# AI_BASE_URL=https://api.openai.com/v1

# Optional: Organization ID (for OpenAI)
# AI_ORGANIZATION=org-your-org-id

# Optional: Default model
# AI_DEFAULT_MODEL=gpt-4o

# Optional: Request timeout (ms)
# AI_TIMEOUT=30000

# Optional: Max retries for failed requests
# AI_MAX_RETRIES=3

# Optional: ElevenLabs default voice ID
# AI_DEFAULT_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### 2. Use the Provider

```typescript
import { getProvider } from './providers';

async function example() {
  // Get the configured provider (uses ACTIVE_AI_PROVIDER env var)
  const ai = getProvider();

  // Chat completion
  const chatResponse = await ai.chat([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ]);
  console.log(chatResponse.message.content);

  // Streaming chat
  for await (const chunk of ai.chatStream([{ role: 'user', content: 'Tell me a story.' }])) {
    process.stdout.write(chunk.delta.content || '');
  }

  // Create embeddings
  const embedResponse = await ai.embed('Hello, world!');
  console.log(embedResponse.embedding);

  // Text-to-speech
  const audio = await ai.speak('Hello, world!');
  // audio.audioBuffer contains the audio data

  // Speech-to-text
  const transcription = await ai.transcribe(audioBuffer);
  console.log(transcription.text);
}
```

## Provider Details

### OpenAI

Full-featured provider supporting all capabilities.

**Supported Models:**

- Chat: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`
- Transcription: `whisper-1`
- Text-to-Speech: `tts-1`, `tts-1-hd`
- Embeddings: `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002`

**Features:**

- Streaming chat completions
- Token limit validation
- Rate limit handling with retry-after headers
- Batch embeddings with configurable batch size

**Example:**

```typescript
const provider = createProvider('openai', {
  apiKey: 'sk-...',
  defaultModel: 'gpt-4o',
});

// Chat with custom options
const response = await provider.chat(messages, {
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
});
```

### Anthropic

Claude models for high-quality text generation.

**Supported Models:**

- `claude-3-5-sonnet-20241022` (default)
- `claude-3-5-sonnet-20240620`
- `claude-3-5-haiku-20241022`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

**Features:**

- Content block handling (multiple text blocks)
- System message support
- Stop reason mapping (end_turn, max_tokens, stop_sequence)
- Overload error handling (529 status)

**Example:**

```typescript
const provider = createProvider('anthropic', {
  apiKey: 'sk-ant-...',
  defaultModel: 'claude-3-5-sonnet-20241022',
});

// Chat with system prompt
const response = await provider.chat(
  [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing.' },
  ],
  {
    maxTokens: 2000,
    temperature: 0.5,
  }
);
```

### Deepgram

Speech-to-text with real-time streaming support.

**Supported Models:**

- `nova-2` (default), `nova-2-general`, `nova-2-meeting`
- `nova-2-phonecall`, `nova-2-finance`, `nova-2-conversationalai`
- `nova-2-voicemail`, `nova-2-medical`, `nova-2-drivethru`, `nova-2-automotive`
- `nova`, `enhanced`, `base`

**Features:**

- Batch transcription via REST API
- Real-time streaming via WebSocket
- Automatic reconnection on connection drop
- Speaker diarization
- Punctuation and smart formatting

**Example:**

```typescript
const provider = createProvider('deepgram', {
  apiKey: 'your-deepgram-key',
  defaultModel: 'nova-2',
});

// Batch transcription
const result = await provider.transcribe(audioBuffer, {
  language: 'en',
  punctuate: true,
  smart_format: true,
  diarize: true,
});

// Real-time streaming
const session = await provider.createRealtimeSession({
  onTranscription: (result) => {
    console.log(result.transcript, result.isFinal);
  },
  onError: (error) => console.error(error),
});

// Send audio chunks
session.send(audioChunk);

// Close when done
session.close();
```

### ElevenLabs

Text-to-speech with voice customization.

**Supported Models:**

- `eleven_multilingual_v2` (default)
- `eleven_turbo_v2_5`
- `eleven_turbo_v2`
- `eleven_monolingual_v1`
- `eleven_multilingual_v1`

**Features:**

- Multiple voice options
- Voice settings (stability, similarity boost, style)
- Streaming audio response
- Multiple output formats (MP3, PCM, μ-law)

**Example:**

```typescript
const provider = createProvider('elevenlabs', {
  apiKey: 'your-elevenlabs-key',
  defaultModel: 'eleven_multilingual_v2',
  defaultVoiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
});

// Generate speech
const audio = await provider.speak('Hello, world!', {
  voice_id: 'pNInz6obpgDQGcFmaJgB', // Adam
  stability: 0.7,
  similarity_boost: 0.8,
  style: 0.5,
  use_speaker_boost: true,
  output_format: 'mp3_44100_128',
});

// Get available voices
const voices = await provider.getVoices();
```

## API Reference

### AIProvider Interface

```typescript
interface AIProvider {
  readonly name: string;
  readonly supportedModels: string[];

  // Chat
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk>;

  // Transcription
  transcribe(
    audio: Buffer | ReadableStream,
    options?: TranscribeOptions
  ): Promise<TranscribeResponse>;

  // Text-to-Speech
  speak(text: string, options?: SpeakOptions): Promise<SpeakResponse>;

  // Embeddings
  embed(text: string, options?: EmbedOptions): Promise<EmbedResponse>;
  embedBatch(texts: string[], options?: EmbedBatchOptions): Promise<EmbedBatchResponse>;

  // Health
  healthCheck(): Promise<boolean>;
}
```

### Factory Functions

```typescript
// Get singleton instance (uses ACTIVE_AI_PROVIDER env var)
const provider = getProvider();

// Create instance with explicit config
const provider = createProvider('openai', {
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
});

// Reset singleton (useful for testing)
resetProvider();

// Get list of available providers
const providers = getAvailableProviders();

// Validate configuration
const errors = validateProviderConfig({ apiKey: '' });
```

## Per-Tenant Configuration

Support tenant-specific API keys and provider configurations stored encrypted in the database.

### Setup

```typescript
import { createTenantAIConfigService, getProviderForTenant } from './providers';

// Initialize encryption service
const configService = createTenantAIConfigService(process.env.TENANT_AI_ENCRYPTION_KEY);

// Get provider for specific tenant
const provider = await getProviderForTenant(tenantId, 'openai', configService, tenantConfig);
```

### Database Schema

The `tenant.ai_configs` table stores encrypted API keys:

```sql
CREATE TABLE tenant.ai_configs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  base_url TEXT,
  default_model VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Error Handling

All providers throw structured errors:

```typescript
import {
  ProviderError,
  RateLimitError,
  TokenLimitError,
  AnthropicProviderError,
  AnthropicRateLimitError,
  AnthropicOverloadedError,
  DeepgramProviderError,
  DeepgramRateLimitError,
  ElevenLabsProviderError,
  ElevenLabsRateLimitError,
} from './providers';

try {
  const response = await provider.chat(messages);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after: ${error.retryAfter}s`);
  } else if (error instanceof TokenLimitError) {
    console.log(`Token limit: ${error.tokenCount}/${error.maxTokens}`);
  } else if (error instanceof ProviderError) {
    console.log(`Provider error: ${error.message} (${error.errorCode})`);
    console.log(`Retryable: ${error.isRetryable}`);
  }
}
```

## Adding a New Provider

### 1. Create Provider Implementation

Create a new file in `implementations/`:

```typescript
// implementations/my-provider.ts
import { AIProvider, ProviderConfig, ChatMessage, ChatOptions, ChatResponse } from '../types';

export class MyProviderError extends Error {
  public readonly provider = 'my-provider';
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(options: { message: string; statusCode?: number; isRetryable?: boolean }) {
    super(options.message);
    this.name = 'MyProviderError';
    this.statusCode = options.statusCode;
    this.isRetryable = options.isRetryable ?? false;
  }
}

export class MyProvider implements AIProvider {
  readonly name = 'my-provider';
  readonly supportedModels = ['model-1', 'model-2'];

  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // Implement chat logic with retry
    throw new Error('Not implemented');
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatStreamChunk> {
    // Implement streaming chat
    throw new Error('Not implemented');
  }

  async transcribe(
    audio: Buffer | ReadableStream,
    options?: TranscribeOptions
  ): Promise<TranscribeResponse> {
    throw new MyProviderError({
      message: 'Transcription not supported',
      statusCode: 501,
      isRetryable: false,
    });
  }

  async speak(text: string, options?: SpeakOptions): Promise<SpeakResponse> {
    throw new MyProviderError({
      message: 'Text-to-speech not supported',
      statusCode: 501,
      isRetryable: false,
    });
  }

  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    throw new MyProviderError({
      message: 'Embeddings not supported',
      statusCode: 501,
      isRetryable: false,
    });
  }

  async embedBatch(texts: string[], options?: EmbedBatchOptions): Promise<EmbedBatchResponse> {
    throw new MyProviderError({
      message: 'Embeddings not supported',
      statusCode: 501,
      isRetryable: false,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Check provider connectivity
      return true;
    } catch {
      return false;
    }
  }
}
```

### 2. Register the Provider

In `implementations/index.ts`:

```typescript
import { registerProvider } from '../factory';
import { MyProvider, MyProviderError } from './my-provider';

// Register provider
registerProvider('my-provider', MyProvider);

// Export error types
export { MyProvider, MyProviderError };
```

### 3. Update Types

Add to `ProviderName` type in `types.ts`:

```typescript
export type ProviderName = 'openai' | 'anthropic' | 'deepgram' | 'elevenlabs' | 'my-provider'; // Add here
```

### 4. Update Main Index

In `index.ts`:

```typescript
// Export new provider
export { MyProvider, MyProviderError } from './implementations/my-provider';
```

## Environment Variables Reference

| Variable                   | Required | Default          | Description                            |
| -------------------------- | -------- | ---------------- | -------------------------------------- |
| `ACTIVE_AI_PROVIDER`       | No       | `openai`         | Provider to use                        |
| `AI_API_KEY`               | Yes\*    | -                | API key for the provider               |
| `AI_BASE_URL`              | No       | Provider default | Custom API endpoint                    |
| `AI_ORGANIZATION`          | No       | -                | Organization ID (OpenAI)               |
| `AI_DEFAULT_MODEL`         | No       | Provider default | Default model to use                   |
| `AI_DEFAULT_VOICE_ID`      | No       | Provider default | Default voice ID (ElevenLabs)          |
| `AI_TIMEOUT`               | No       | `30000`          | Request timeout (ms)                   |
| `AI_MAX_RETRIES`           | No       | `3`              | Max retry attempts                     |
| `TENANT_AI_ENCRYPTION_KEY` | No       | -                | Encryption key for per-tenant API keys |

\*Not required for Ollama or Custom providers

## Testing

```typescript
import { createProvider, resetProvider } from '../providers';
import { describe, it, expect, beforeEach } from 'vitest';

describe('AI Integration', () => {
  beforeEach(() => {
    resetProvider();
  });

  it('should use OpenAI provider', async () => {
    const provider = createProvider('openai', {
      apiKey: 'test-key',
    });

    expect(provider.name).toBe('openai');
    expect(provider.supportedModels).toContain('gpt-4o');
  });

  it('should throw error for unknown provider', () => {
    expect(() => createProvider('unknown' as any, { apiKey: 'test' })).toThrow('Unknown provider');
  });
});
```

## Architecture

```
packages/backend/src/providers/
├── index.ts                    # Barrel exports
├── types.ts                    # Type definitions
├── factory.ts                  # Provider factory & singleton
├── tenant-config.ts            # Per-tenant configuration
├── README.md                   # This file
├── implementations/
│   ├── index.ts                # Provider registration
│   ├── openai.ts               # OpenAI implementation
│   ├── anthropic.ts            # Anthropic implementation
│   ├── deepgram.ts             # Deepgram implementation
│   └── elevenlabs.ts           # ElevenLabs implementation
└── __tests__/
    ├── openai.test.ts          # OpenAI tests
    ├── anthropic.test.ts       # Anthropic tests
    ├── deepgram.test.ts        # Deepgram tests
    └── elevenlabs.test.ts      # ElevenLabs tests
```
