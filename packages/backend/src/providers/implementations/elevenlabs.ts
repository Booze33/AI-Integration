/**
 * ElevenLabs Provider Implementation
 *
 * Implements the AIProvider interface using ElevenLabs' API.
 * Supports text-to-speech with voice ID configuration and audio streaming.
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
 * ElevenLabs API error response
 */
interface ElevenLabsError {
  detail: {
    status: string;
    message: string;
  };
}

/**
 * ElevenLabs voice response
 */
interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  samples: Array<{
    sample_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    hash: string;
  }>;
  category: string;
  fine_tuning: {
    model_id: string;
    is_allowed_to_fine_tune: boolean;
    fine_tuning_requested: boolean;
    finetuning_state: string;
    verification_failures: string[];
    verification_attempts_count: number;
    manual_verification_requested: boolean;
  };
  labels: Record<string, string>;
  description: string;
  preview_url: string;
  available_for_tiers: string[];
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
  sharing: {
    status: string;
    history_item_sample_id: string;
    original_voice_id: string;
    public_owner_id: string;
    liked_by_count: number;
    cloned_by_count: string;
    name: string;
    description: string;
    labels: Record<string, string>;
    review_status: string;
    review_message: string;
    enabled_in_library: boolean;
  };
  high_quality_base_model_ids: string[];
}

/**
 * ElevenLabs voices list response
 */
interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

/**
 * Structured error for provider operations
 */
export class ElevenLabsProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly errorCode?: string;
  public readonly isRetryable: boolean;
  public readonly originalError?: Error;

  constructor(options: {
    message: string;
    statusCode?: number;
    errorCode?: string;
    isRetryable?: boolean;
    cause?: Error;
  }) {
    super(options.message);
    this.name = 'ElevenLabsProviderError';
    this.provider = 'elevenlabs';
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.isRetryable = options.isRetryable ?? false;
    this.originalError = options.cause;
  }
}

/**
 * Rate limit error
 */
export class ElevenLabsRateLimitError extends ElevenLabsProviderError {
  public readonly retryAfter?: number;

  constructor(options: { message: string; retryAfter?: number; cause?: Error }) {
    super({
      message: options.message,
      statusCode: 429,
      errorCode: 'rate_limit_exceeded',
      isRetryable: true,
      cause: options.cause,
    });
    this.name = 'ElevenLabsRateLimitError';
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
 * ElevenLabs-specific speak options
 */
interface ElevenLabsSpeakOptions extends SpeakOptions {
  voice_id?: string;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  optimize_streaming_latency?: number;
  output_format?:
    | 'mp3_22050_32'
    | 'mp3_44100_32'
    | 'mp3_44100_64'
    | 'mp3_44100_96'
    | 'mp3_44100_128'
    | 'mp3_44100_192'
    | 'pcm_16000'
    | 'pcm_22050'
    | 'pcm_24000'
    | 'pcm_44100'
    | 'ulaw_8000';
}

/**
 * ElevenLabs Provider Implementation
 */
export class ElevenLabsProvider implements AIProvider {
  readonly name = 'elevenlabs';
  readonly supportedModels = [
    'eleven_multilingual_v2',
    'eleven_turbo_v2_5',
    'eleven_turbo_v2',
    'eleven_monolingual_v1',
    'eleven_multilingual_v1',
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultVoiceId: string;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;

  constructor(config: ProviderConfig & { defaultVoiceId?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.elevenlabs.io/v1';
    this.defaultVoiceId = config.defaultVoiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel voice
    this.timeout = config.timeout || 60000;
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: 1000,
      maxDelay: 30000,
    };
  }

  /**
   * Get common headers for ElevenLabs requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'xi-api-key': this.apiKey,
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
        const errorData = (await response.json().catch(() => null)) as ElevenLabsError | null;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new ElevenLabsRateLimitError({
            message: errorData?.detail?.message || 'Rate limit exceeded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        throw new ElevenLabsProviderError({
          message: errorData?.detail?.message || `HTTP ${response.status}`,
          statusCode: response.status,
          errorCode: errorData?.detail?.status,
          isRetryable: response.status >= 500,
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ElevenLabsProviderError || error instanceof ElevenLabsRateLimitError) {
        if (error.isRetryable && retryCount < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(retryCount, error);
          await this.sleep(delay);
          return this.fetchWithRetry<T>(url, options, retryCount + 1);
        }
        throw error;
      }

      if (error instanceof Error && retryCount < this.retryConfig.maxRetries) {
        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);
        return this.fetchWithRetry<T>(url, options, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Make a streaming HTTP request with retry logic
   */
  private async fetchStreamWithRetry(
    url: string,
    options: RequestInit,
    retryCount = 0
  ): Promise<ReadableStream> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as ElevenLabsError | null;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new ElevenLabsRateLimitError({
            message: errorData?.detail?.message || 'Rate limit exceeded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        throw new ElevenLabsProviderError({
          message: errorData?.detail?.message || `HTTP ${response.status}`,
          statusCode: response.status,
          errorCode: errorData?.detail?.status,
          isRetryable: response.status >= 500,
        });
      }

      if (!response.body) {
        throw new ElevenLabsProviderError({
          message: 'Response body is empty',
          isRetryable: false,
        });
      }

      return response.body;
    } catch (error) {
      if (error instanceof ElevenLabsProviderError || error instanceof ElevenLabsRateLimitError) {
        if (error.isRetryable && retryCount < this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(retryCount, error);
          await this.sleep(delay);
          return this.fetchStreamWithRetry(url, options, retryCount + 1);
        }
        throw error;
      }

      if (error instanceof Error && retryCount < this.retryConfig.maxRetries) {
        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);
        return this.fetchStreamWithRetry(url, options, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number, error?: Error): number {
    if (error instanceof ElevenLabsRateLimitError && error.retryAfter) {
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
   * Get available voices
   */
  async getVoices(): Promise<ElevenLabsVoice[]> {
    const url = `${this.baseUrl}/voices`;
    const response = await this.fetchWithRetry<ElevenLabsVoicesResponse>(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return response.voices;
  }

  /**
   * Chat completion
   * Note: ElevenLabs doesn't provide a chat API
   */
  async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    throw new ElevenLabsProviderError({
      message:
        'ElevenLabs does not provide a chat API. Use OpenAI or Anthropic for chat completions.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Streaming chat completion
   * Note: ElevenLabs doesn't provide a chat API
   */
  // eslint-disable-next-line require-yield
  async *chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<ChatStreamChunk> {
    throw new ElevenLabsProviderError({
      message:
        'ElevenLabs does not provide a chat API. Use OpenAI or Anthropic for chat completions.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Speech-to-text transcription
   * Note: ElevenLabs doesn't provide a transcription API
   */
  async transcribe(
    _audio: Buffer | ReadableStream,
    _options?: TranscribeOptions
  ): Promise<TranscribeResponse> {
    throw new ElevenLabsProviderError({
      message:
        'ElevenLabs does not provide a transcription API. Use OpenAI Whisper or Deepgram for transcription.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Text-to-speech synthesis
   * Returns audio stream for efficient handling
   */
  async speak(
    text: string,
    options?: ElevenLabsSpeakOptions
  ): Promise<SpeakResponse & { stream: ReadableStream }> {
    const voiceId = options?.voice_id || this.defaultVoiceId;
    const url = `${this.baseUrl}/text-to-speech/${voiceId}/stream`;

    const body: Record<string, unknown> = {
      text,
      model_id: options?.model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: options?.stability ?? 0.5,
        similarity_boost: options?.similarity_boost ?? 0.75,
        style: options?.style ?? 0,
        use_speaker_boost: options?.use_speaker_boost ?? true,
      },
    };

    if (options?.optimize_streaming_latency !== undefined) {
      body.optimize_streaming_latency = options.optimize_streaming_latency;
    }

    if (options?.output_format) {
      body.output_format = options.output_format;
    }

    const stream = await this.fetchStreamWithRetry(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    // Determine content type based on output format
    const outputFormat = options?.output_format || 'mp3_44100_128';
    let contentType = 'audio/mpeg';
    if (outputFormat.startsWith('pcm')) {
      contentType = 'audio/pcm';
    } else if (outputFormat.startsWith('ulaw')) {
      contentType = 'audio/basic';
    }

    return {
      audioBuffer: Buffer.alloc(0), // Empty buffer - use stream instead
      stream,
      contentType,
    };
  }

  /**
   * Create embeddings
   * Note: ElevenLabs doesn't provide an embeddings API
   */
  async embed(_text: string, _options?: EmbedOptions): Promise<EmbedResponse> {
    throw new ElevenLabsProviderError({
      message:
        'ElevenLabs does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Create embeddings for multiple texts
   * Note: ElevenLabs doesn't provide an embeddings API
   */
  async embedBatch(_texts: string[], _options?: EmbedBatchOptions): Promise<EmbedBatchResponse> {
    throw new ElevenLabsProviderError({
      message:
        'ElevenLabs does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/user`;
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
