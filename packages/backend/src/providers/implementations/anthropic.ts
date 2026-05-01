/**
 * Anthropic Provider Implementation
 *
 * Implements the AIProvider interface using Anthropic's Claude API.
 * Supports Claude streaming, stop reasons, and content blocks.
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
 * Anthropic API error response
 */
interface AnthropicError {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

/**
 * Anthropic message content block types
 */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

/**
 * Anthropic message response
 */
interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic streaming event types
 */
type AnthropicStreamEvent =
  | { type: 'message_start'; message: AnthropicMessageResponse }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: { stop_reason: string | null; stop_sequence: string | null };
      usage: { output_tokens: number };
    }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: AnthropicError['error'] };

/**
 * Structured error for provider operations
 */
export class AnthropicProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly errorType?: string;
  public readonly isRetryable: boolean;
  public readonly originalError?: Error;

  constructor(options: {
    message: string;
    statusCode?: number;
    errorType?: string;
    isRetryable?: boolean;
    cause?: Error;
  }) {
    super(options.message);
    this.name = 'AnthropicProviderError';
    this.provider = 'anthropic';
    this.statusCode = options.statusCode;
    this.errorType = options.errorType;
    this.isRetryable = options.isRetryable ?? false;
    this.originalError = options.cause;
  }
}

/**
 * Rate limit error
 */
export class AnthropicRateLimitError extends AnthropicProviderError {
  public readonly retryAfter?: number;

  constructor(options: { message: string; retryAfter?: number; cause?: Error }) {
    super({
      message: options.message,
      statusCode: 429,
      errorType: 'rate_limit_error',
      isRetryable: true,
      cause: options.cause,
    });
    this.name = 'AnthropicRateLimitError';
    this.retryAfter = options.retryAfter;
  }
}

/**
 * Overloaded error (similar to rate limit but for load)
 */
export class AnthropicOverloadedError extends AnthropicProviderError {
  public readonly retryAfter?: number;

  constructor(options: { message: string; retryAfter?: number }) {
    super({
      message: options.message,
      statusCode: 529,
      errorType: 'overloaded_error',
      isRetryable: true,
    });
    this.name = 'AnthropicOverloadedError';
    this.retryAfter = options.retryAfter;
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
 * Model token limits
 */
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
};

/**
 * Anthropic Provider Implementation
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly supportedModels = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.defaultModel = config.defaultModel || 'claude-3-5-sonnet-20241022';
    this.timeout = config.timeout || 60000;
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: 1000,
      maxDelay: 60000,
    };
  }

  /**
   * Get common headers for Anthropic requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  /**
   * Convert internal messages to Anthropic format
   */
  private convertMessages(messages: ChatMessage[]): {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    const systemMessages: string[] = [];
    const convertedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessages.push(message.content);
      } else if (message.role === 'user' || message.role === 'assistant') {
        convertedMessages.push({
          role: message.role,
          content: message.content,
        });
      }
      // Skip 'function' role messages as Anthropic doesn't support them directly
    }

    return {
      system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
      messages: convertedMessages,
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
        const errorData = (await response.json().catch(() => null)) as AnthropicError | null;

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new AnthropicRateLimitError({
            message: errorData?.error?.message || 'Rate limit exceeded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        // Handle overloaded
        if (response.status === 529) {
          const retryAfter = response.headers.get('Retry-After');
          throw new AnthropicOverloadedError({
            message: errorData?.error?.message || 'API overloaded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        throw new AnthropicProviderError({
          message: errorData?.error?.message || `HTTP ${response.status}`,
          statusCode: response.status,
          errorType: errorData?.error?.type,
          isRetryable: response.status >= 500,
        });
      }

      return await response.json();
    } catch (error) {
      if (
        error instanceof AnthropicProviderError ||
        error instanceof AnthropicRateLimitError ||
        error instanceof AnthropicOverloadedError
      ) {
        // Retry on rate limit, overloaded, or retryable errors
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
  private calculateRetryDelay(
    retryCount: number,
    error?: AnthropicRateLimitError | AnthropicOverloadedError
  ): number {
    if (error?.retryAfter) {
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
   * Estimate token count (rough approximation)
   */
  private estimateTokenCount(messages: ChatMessage[]): number {
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
    const maxTokens = MODEL_TOKEN_LIMITS[model] || 100000;
    const estimatedTokens = this.estimateTokenCount(messages);

    if (estimatedTokens > maxTokens * 0.9) {
      throw new AnthropicProviderError({
        message: `Estimated token count (${estimatedTokens}) approaches model limit (${maxTokens})`,
        statusCode: 400,
        errorType: 'token_limit_exceeded',
        isRetryable: false,
      });
    }
  }

  /**
   * Map Anthropic stop reason to standard finish reason
   */
  private mapStopReason(stopReason: string | null): string {
    switch (stopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  /**
   * Chat completion
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this.validateTokenLimits(messages, options);

    const model = options?.model || this.defaultModel;
    const url = `${this.baseUrl}/v1/messages`;

    const { system, messages: convertedMessages } = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: convertedMessages,
      max_tokens: options?.maxTokens || 4096,
      stream: false,
    };

    if (system) {
      body.system = system;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options?.stop && options.stop.length > 0) {
      body.stop_sequences = options.stop;
    }

    const response = await this.fetchWithRetry<AnthropicMessageResponse>(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    // Extract text content from content blocks
    const textContent = response.content
      .filter((block): block is AnthropicTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      id: response.id,
      message: {
        role: 'assistant',
        content: textContent,
      },
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: this.mapStopReason(response.stop_reason),
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
    const url = `${this.baseUrl}/v1/messages`;

    const { system, messages: convertedMessages } = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: convertedMessages,
      max_tokens: options?.maxTokens || 4096,
      stream: true,
    };

    if (system) {
      body.system = system;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options?.stop && options.stop.length > 0) {
      body.stop_sequences = options.stop;
    }

    let retries = 0;
    let messageId = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finalStopReason: string | null = null;

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
          const errorData = (await response.json().catch(() => null)) as AnthropicError | null;

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
            throw new AnthropicRateLimitError({
              message: errorData?.error?.message || 'Rate limit exceeded',
              retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
            });
          }

          if (response.status === 529) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.calculateRetryDelay(retries);

            if (retries < this.retryConfig.maxRetries) {
              await this.sleep(delay);
              retries++;
              continue;
            }
            throw new AnthropicOverloadedError({
              message: errorData?.error?.message || 'API overloaded',
              retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
            });
          }

          throw new AnthropicProviderError({
            message: errorData?.error?.message || `HTTP ${response.status}`,
            statusCode: response.status,
            errorType: errorData?.error?.type,
            isRetryable: response.status >= 500,
          });
        }

        if (!response.body) {
          throw new AnthropicProviderError({
            message: 'Response body is empty',
            isRetryable: false,
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

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

            try {
              const event = JSON.parse(data) as AnthropicStreamEvent;

              switch (event.type) {
                case 'message_start':
                  messageId = event.message.id;
                  inputTokens = event.message.usage.input_tokens;
                  break;

                case 'content_block_delta':
                  if (event.delta.type === 'text_delta') {
                    yield {
                      id: messageId,
                      delta: {
                        role: 'assistant',
                        content: event.delta.text,
                      },
                      model,
                    };
                  }
                  break;

                case 'message_delta':
                  outputTokens = event.usage.output_tokens;
                  finalStopReason = event.delta.stop_reason;
                  break;

                case 'message_stop':
                  yield {
                    id: messageId,
                    delta: {},
                    model,
                    finishReason: this.mapStopReason(finalStopReason),
                    usage: {
                      promptTokens: inputTokens,
                      completionTokens: outputTokens,
                      totalTokens: inputTokens + outputTokens,
                    },
                  };
                  return;

                case 'error':
                  throw new AnthropicProviderError({
                    message: event.error.message,
                    errorType: event.error.type,
                    isRetryable: false,
                  });

                case 'ping':
                  // Ignore ping events
                  break;
              }
            } catch (e) {
              if (e instanceof AnthropicProviderError) {
                throw e;
              }
              // Skip malformed JSON chunks
              continue;
            }
          }
        }

        return;
      } catch (error) {
        if (
          error instanceof AnthropicProviderError ||
          error instanceof AnthropicRateLimitError ||
          error instanceof AnthropicOverloadedError
        ) {
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
   * Note: Anthropic doesn't provide a transcription API
   */
  async transcribe(
    _audio: Buffer | ReadableStream,
    _options?: TranscribeOptions
  ): Promise<TranscribeResponse> {
    throw new AnthropicProviderError({
      message:
        'Anthropic does not provide a transcription API. Use OpenAI Whisper or another provider for transcription.',
      statusCode: 501,
      errorType: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Text-to-speech synthesis
   * Note: Anthropic doesn't provide a TTS API
   */
  async speak(_text: string, _options?: SpeakOptions): Promise<SpeakResponse> {
    throw new AnthropicProviderError({
      message:
        'Anthropic does not provide a text-to-speech API. Use OpenAI TTS or another provider for speech synthesis.',
      statusCode: 501,
      errorType: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Create embeddings for a single text
   * Note: Anthropic doesn't provide an embeddings API
   */
  async embed(_text: string, _options?: EmbedOptions): Promise<EmbedResponse> {
    throw new AnthropicProviderError({
      message:
        'Anthropic does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
      statusCode: 501,
      errorType: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Create embeddings for multiple texts
   * Note: Anthropic doesn't provide an embeddings API
   */
  async embedBatch(_texts: string[], _options?: EmbedBatchOptions): Promise<EmbedBatchResponse> {
    throw new AnthropicProviderError({
      message:
        'Anthropic does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
      statusCode: 501,
      errorType: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });
      // Any response (even error) means the API is reachable
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
