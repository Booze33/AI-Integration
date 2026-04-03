# AI Providers Module

This module provides a unified interface for interacting with various AI providers. Switching between providers is as simple as changing one environment variable.

## Features

- **Unified Interface**: Single `AIProvider` interface for all AI services
- **Easy Switching**: Change providers with `AI_PROVIDER` environment variable
- **Type Safety**: Full TypeScript support with comprehensive types
- **Extensible**: Easy to add new provider implementations

## Supported Providers

| Provider     | Chat | Transcribe | Speak | Embed |
| ------------ | ---- | ---------- | ----- | ----- |
| OpenAI       | ✅   | ✅         | ✅    | ✅    |
| Anthropic    | ✅   | ❌         | ❌    | ❌    |
| Azure OpenAI | ✅   | ✅         | ✅    | ✅    |
| Google       | ✅   | ✅         | ✅    | ✅    |
| Mistral      | ✅   | ❌         | ❌    | ✅    |
| Groq         | ✅   | ✅         | ❌    | ❌    |
| Ollama       | ✅   | ❌         | ✅    | ✅    |
| Custom       | ✅   | ✅         | ✅    | ✅    |

## Quick Start

### 1. Configure Environment Variables

Add to your `.env` file:

```env
# Choose your provider
AI_PROVIDER=openai

# Set your API key
AI_API_KEY=sk-your-api-key-here

# Optional: Set a custom base URL
# AI_BASE_URL=https://api.openai.com/v1

# Optional: Set organization ID
# AI_ORGANIZATION=org-your-org-id

# Optional: Set default model
# AI_DEFAULT_MODEL=gpt-4

# Optional: Request timeout (ms)
# AI_TIMEOUT=30000

# Optional: Max retries
# AI_MAX_RETRIES=3
```

### 2. Use the Provider

```typescript
import { getProvider } from './providers';

async function example() {
  // Get the configured provider
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
// Get singleton instance (uses env vars)
const provider = getProvider();

// Create instance with explicit config
const provider = createProvider('openai', {
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',
});

// Reset singleton (useful for testing)
resetProvider();

// Get list of available providers
const providers = getAvailableProviders();
```

## Adding a New Provider

### 1. Create Provider Implementation

Create a new file in `implementations/`:

```typescript
// implementations/my-provider.ts
import { AIProvider, ProviderConfig, ChatMessage, ChatOptions, ChatResponse } from '../types';

export class MyProvider implements AIProvider {
  readonly name = 'my-provider';
  readonly supportedModels = ['model-1', 'model-2'];

  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // Implement chat logic
    throw new Error('Not implemented');
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions) {
    // Implement streaming chat
    throw new Error('Not implemented');
  }

  async transcribe(audio: Buffer | ReadableStream, options?) {
    throw new Error('Not implemented');
  }

  async speak(text: string, options?) {
    throw new Error('Not implemented');
  }

  async embed(text: string, options?) {
    throw new Error('Not implemented');
  }

  async embedBatch(texts: string[], options?) {
    throw new Error('Not implemented');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
```

### 2. Register the Provider

In `implementations/index.ts`:

```typescript
import { registerProvider } from '../factory';
import { MyProvider } from './my-provider';

registerProvider('my-provider', MyProvider);
```

### 3. Update Types

Add to `ProviderName` type in `types.ts`:

```typescript
export type ProviderName =
  | 'openai'
  | 'anthropic'
  // ... existing providers
  | 'my-provider'; // Add here
```

## Environment Variables Reference

| Variable           | Required | Default          | Description              |
| ------------------ | -------- | ---------------- | ------------------------ |
| `AI_PROVIDER`      | No       | `openai`         | Provider to use          |
| `AI_API_KEY`       | Yes\*    | -                | API key for the provider |
| `AI_BASE_URL`      | No       | Provider default | Custom API endpoint      |
| `AI_ORGANIZATION`  | No       | -                | Organization ID          |
| `AI_DEFAULT_MODEL` | No       | Provider default | Default model to use     |
| `AI_TIMEOUT`       | No       | `30000`          | Request timeout (ms)     |
| `AI_MAX_RETRIES`   | No       | `3`              | Max retry attempts       |

\*Not required for Ollama or Custom providers

## Error Handling

The provider factory throws errors for:

- Missing API key (when required)
- Unknown provider name
- Invalid configuration

```typescript
try {
  const provider = getProvider();
} catch (error) {
  if (error.message.includes('Unknown provider')) {
    console.error('Check AI_PROVIDER environment variable');
  }
  if (error.message.includes('AI_API_KEY')) {
    console.error('Set AI_API_KEY environment variable');
  }
}
```

## Testing

```typescript
import { createProvider, resetProvider } from '../providers';

describe('MyFeature', () => {
  beforeEach(() => {
    resetProvider();
  });

  it('should use AI provider', async () => {
    const provider = createProvider('openai', {
      apiKey: 'test-key',
    });
    // test with provider
  });
});
```
