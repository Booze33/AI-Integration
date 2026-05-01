/**
 * OpenAI Provider Implementation
 *
 * Implements the AIProvider interface using OpenAI's API.
 * Supports GPT-4o chat with streaming, token limits, rate limit retries, and structured errors.
 */

import {
  AIProvider,
  ProviderConfig,
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
} from '../types';

/**
 * OpenAI API error response
 */
interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

/**
 * Structured error for provider operations
 */
export class ProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly errorCode?: string;
  public readonly isRetryable: boolean;
  public readonly originalError?: Error;

  constructor(options: {
    message: string;
    provider: string;
    statusCode?: number;
    errorCode?: string;
    isRetryable?: boolean;
    cause?: Error;
  }) {
    super(options.message);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.isRetryable = options.isRetryable ?? false;
    this.originalError = options.cause;
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends ProviderError {
  public readonly retryAfter?: number;

  constructor(options: { message: string; retryAfter?: number; cause?: Error }) {
    super({
      message: options.message,
      provider: 'openai',
      statusCode: 429,
      errorCode: 'rate_limit_exceeded',
      isRetryable: true,
      cause: options.cause,
    });
    this.name = 'RateLimitError';
    this.retryAfter = options.retryAfter;
  }
}

/**
 * Token limit error
 */
export class TokenLimitError extends ProviderError {
  public readonly tokenCount: number;
  public readonly maxTokens: number;

  constructor(options: { message: string; tokenCount: number; maxTokens: number }) {
    super({
      message: options.message,
      provider: 'openai',
      statusCode: 400,
      errorCode: 'token_limit_exceeded',
      isRetryable: false,
    });
    this.name = 'TokenLimitError';
    this.tokenCount = options.tokenCount;
    this.maxTokens = options.maxTokens;
  }
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

/**
 * OpenAI chat completion response
 */
interface OpenAIChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI streaming chunk
 */
interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  /** Present on the trailing usage chunk when stream_options.include_usage is true. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI embedding response
 */
interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Model token limits
 */
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
};

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly supportedModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-4-32k',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organization?: string;
  private readonly defaultModel: string;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.organization = config.organization;
    this.defaultModel = config.defaultModel || 'gpt-4o';
    this.timeout = config.timeout || 30000;
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: 1000,
      maxDelay: 30000,
    };
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async fetchWithRetry<T>(url: string, options: RequestInit, retryCount = 0): Promise<T> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as OpenAIError | null;

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new RateLimitError({
            message: errorData?.error?.message || 'Rate limit exceeded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        throw new ProviderError({
          message: errorData?.error?.message || `HTTP ${response.status}`,
          provider: 'openai',
          statusCode: response.status,
          errorCode: errorData?.error?.code,
          isRetryable: response.status >= 500,
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError || error instanceof RateLimitError) {
        // Retry on rate limit or retryable errors
        if (error.isRetryable && retryCount < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(retryCount, error);
          await this.sleep(delay);
          return this.fetchWithRetry<T>(url, options, retryCount + 1);
        }
        throw error;
      }

      // Retry on network errors
      if (error instanceof Error && retryCount < this.retryConfig.maxRetries) {
        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);
        return this.fetchWithRetry<T>(url, options, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number, error?: Error): number {
    if (error instanceof RateLimitError && error.retryAfter) {
      return Math.min(error.retryAfter * 1000, this.retryConfig.maxDelay);
    }
    const exponentialDelay = this.retryConfig.baseDelay * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelay);
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get common headers for OpenAI requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }
    return headers;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokenCount(messages: ChatMessage[]): number {
    // Rough estimate: ~4 characters per token
    let totalChars = 0;
    for (const message of messages) {
      totalChars += message.role.length + message.content.length + 10;
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Validate token limits before making request
   */
  private validateTokenLimits(messages: ChatMessage[], options?: ChatOptions): void {
    const model = options?.model || this.defaultModel;
    const maxTokens = MODEL_TOKEN_LIMITS[model] || 4096;
    const estimatedTokens = this.estimateTokenCount(messages);

    if (estimatedTokens > maxTokens * 0.9) {
      throw new TokenLimitError({
        message: `Estimated token count (${estimatedTokens}) approaches model limit (${maxTokens})`,
        tokenCount: estimatedTokens,
        maxTokens,
      });
    }
  }

  /**
   * Chat completion
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.validateTokenLimits(messages, options);

    const model = options?.model || this.defaultModel;
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      frequency_penalty: options?.frequencyPenalty,
      presence_penalty: options?.presencePenalty,
      stop: options?.stop,
      stream: false,
    };

    const response = await this.fetchWithRetry<OpenAIChatCompletion>(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    const choice = response.choices[0];
    return {
      id: response.id,
      message: {
        role: choice.message.role as ChatMessage['role'],
        content: choice.message.content,
      },
      model: response.model,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      finishReason: choice.finish_reason,
    };
  }

  /**
   * Streaming chat completion
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatStreamChunk> {
    this.validateTokenLimits(messages, options);

    const model = options?.model || this.defaultModel;
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      frequency_penalty: options?.frequencyPenalty,
      presence_penalty: options?.presencePenalty,
      stop: options?.stop,
      stream: true,
      stream_options: { include_usage: true },
    };

    let retries = 0;
    while (retries <= this.retryConfig.maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = (await response.json().catch(() => null)) as OpenAIError | null;

          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.calculateRetryDelay(retries);

            if (retries < this.retryConfig.maxRetries) {
              await this.sleep(delay);
              retries++;
              continue;
            }
            throw new RateLimitError({
              message: errorData?.error?.message || 'Rate limit exceeded',
              retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
            });
          }

          throw new ProviderError({
            message: errorData?.error?.message || `HTTP ${response.status}`,
            provider: 'openai',
            statusCode: response.status,
            errorCode: errorData?.error?.code,
            isRetryable: response.status >= 500,
          });
        }

        if (!response.body) {
          throw new ProviderError({
            message: 'Response body is empty',
            provider: 'openai',
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Buffered finish reason — held until the trailing usage chunk arrives
        // (emitted by OpenAI when stream_options.include_usage is true).
        let pendingFinishReason: string | undefined;
        let pendingChunkId: string | undefined;
        let pendingChunkModel: string | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              // Flush any buffered finish reason that arrived without a usage chunk.
              if (pendingFinishReason) {
                yield {
                  id: pendingChunkId || '',
                  delta: {},
                  model: pendingChunkModel || model,
                  finishReason: pendingFinishReason,
                };
              }
              return;
            }

            try {
              const chunk = JSON.parse(data) as OpenAIStreamChunk;

              // Trailing usage-only chunk produced by stream_options.include_usage=true.
              if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
                yield {
                  id: pendingChunkId || chunk.id,
                  delta: {},
                  model: pendingChunkModel || chunk.model,
                  finishReason: pendingFinishReason,
                  usage: {
                    promptTokens: chunk.usage.prompt_tokens,
                    completionTokens: chunk.usage.completion_tokens,
                    totalTokens: chunk.usage.total_tokens,
                  },
                };
                pendingFinishReason = undefined;
                pendingChunkId = undefined;
                pendingChunkModel = undefined;
                continue;
              }

              const choice = chunk.choices[0];

              if (choice?.finish_reason) {
                // Buffer the finish reason; wait for the usage chunk before yielding.
                pendingFinishReason = choice.finish_reason;
                pendingChunkId = chunk.id;
                pendingChunkModel = chunk.model;
                // Still emit any content carried in the same chunk.
                const content = choice?.delta?.content;
                if (content) {
                  yield {
                    id: chunk.id,
                    delta: {
                      role: choice?.delta?.role as ChatMessage['role'] | undefined,
                      content,
                    },
                    model: chunk.model,
                  };
                }
                continue;
              }

              yield {
                id: chunk.id,
                delta: {
                  role: choice?.delta?.role as ChatMessage['role'] | undefined,
                  content: choice?.delta?.content,
                },
                model: chunk.model,
              };
            } catch {
              // Skip malformed JSON chunks
              continue;
            }
          }
        }

        return;
      } catch (error) {
        if (error instanceof ProviderError || error instanceof RateLimitError) {
          if (error.isRetryable && retries < this.retryConfig.maxRetries) {
            const delay = this.calculateRetryDelay(retries, error);
            await this.sleep(delay);
            retries++;
            continue;
          }
          throw error;
        }

        if (retries < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(retries);
          await this.sleep(delay);
          retries++;
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Speech-to-text transcription
   */
  async transcribe(
    audio: Buffer | ReadableStream,
    options?: TranscribeOptions
  ): Promise<TranscribeResponse> {
    const url = `${this.baseUrl}/audio/transcriptions`;

    const formData = new FormData();

    // Convert Buffer to Blob if needed
    if (Buffer.isBuffer(audio)) {
      const uint8Array = new Uint8Array(audio);
      const blob = new Blob([uint8Array], { type: 'audio/mp3' });
      formData.append('file', blob, 'audio.mp3');
    } else {
      // Handle ReadableStream
      const response = new Response(audio);
      const blob = await response.blob();
      formData.append('file', blob, 'audio.mp3');
    }

    formData.append('model', options?.model || 'whisper-1');

    if (options?.language) formData.append('language', options.language);
    if (options?.prompt) formData.append('prompt', options.prompt);
    if (options?.temperature !== undefined) {
      formData.append('temperature', options.temperature.toString());
    }
    if (options?.responseFormat) {
      formData.append('response_format', options.responseFormat);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    const response = await this.fetchWithRetry<TranscribeResponse>(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    return response;
  }

  /**
   * Text-to-speech synthesis
   */
  async speak(text: string, options?: SpeakOptions): Promise<SpeakResponse> {
    const url = `${this.baseUrl}/audio/speech`;

    const body = {
      model: options?.model || 'tts-1',
      input: text,
      voice: options?.voice || 'alloy',
      speed: options?.speed ?? 1.0,
      response_format: options?.responseFormat || 'mp3',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as OpenAIError | null;
        throw new ProviderError({
          message: errorData?.error?.message || `HTTP ${response.status}`,
          provider: 'openai',
          statusCode: response.status,
          errorCode: errorData?.error?.code,
          isRetryable: response.status >= 500,
        });
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      const contentType =
        options?.responseFormat === 'mp3'
          ? 'audio/mpeg'
          : `audio/${options?.responseFormat || 'mp3'}`;

      return {
        audioBuffer,
        contentType,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Create embeddings for a single text
   */
  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    const url = `${this.baseUrl}/embeddings`;
    const model = options?.model || 'text-embedding-3-small';

    const body = {
      model,
      input: text,
    };

    const response = await this.fetchWithRetry<OpenAIEmbeddingResponse>(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    return {
      embedding: response.data[0].embedding,
      model: response.model,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Create embeddings for multiple texts
   */
  async embedBatch(texts: string[], options?: EmbedBatchOptions): Promise<EmbedBatchResponse> {
    const url = `${this.baseUrl}/embeddings`;
    const model = options?.model || 'text-embedding-3-small';
    const batchSize = options?.batchSize || 100;

    const embeddings: number[][] = [];
    let totalPromptTokens = 0;
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const body = {
        model,
        input: batch,
      };

      const response = await this.fetchWithRetry<OpenAIEmbeddingResponse>(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      embeddings.push(...response.data.map((d) => d.embedding));
      totalPromptTokens += response.usage.prompt_tokens;
      totalTokens += response.usage.total_tokens;
    }

    return {
      embeddings,
      model,
      usage: {
        promptTokens: totalPromptTokens,
        totalTokens,
      },
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
