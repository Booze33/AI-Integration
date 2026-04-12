/**
 * Deepgram Provider Implementation
 *
 * Implements the AIProvider interface using Deepgram's API.
 * Supports real-time transcription via WebSocket with automatic reconnection.
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
 * Deepgram API error response
 */
interface DeepgramError {
  err_code: string;
  err_msg: string;
}

/**
 * Deepgram transcription response (REST)
 */
interface DeepgramSyncResponse {
  metadata: {
    request_id: string;
    transaction_key: string;
    sha256: string;
    created: string;
    duration: number;
    channels: number;
    models: string[];
  };
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
        words: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
        }>;
        paragraphs?: {
          paragraphs: Array<{
            sentences: Array<{
              text: string;
              start: number;
              end: number;
            }>;
          }>;
        };
      }>;
    }>;
  };
}

/**
 * Deepgram WebSocket message types
 */
interface DeepgramWebSocketMessage {
  type: 'Results' | 'SpeechStarted' | 'UtteranceEnd' | 'Error' | 'Close';
  channel?: {
    alternatives: Array<{
      transcript: string;
      confidence: number;
      is_final: boolean;
      speech_final: boolean;
      words: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
      }>;
    }>;
  };
  duration?: number;
  start?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel_index?: number[];
  error?: string;
}

/**
 * WebSocket connection states
 */
enum WebSocketState {
  CONNECTING = 'connecting',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

/**
 * Structured error for provider operations
 */
export class DeepgramProviderError extends Error {
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
    this.name = 'DeepgramProviderError';
    this.provider = 'deepgram';
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.isRetryable = options.isRetryable ?? false;
    this.originalError = options.cause;
  }
}

/**
 * Rate limit error
 */
export class DeepgramRateLimitError extends DeepgramProviderError {
  public readonly retryAfter?: number;

  constructor(options: { message: string; retryAfter?: number; cause?: Error }) {
    super({
      message: options.message,
      statusCode: 429,
      errorCode: 'rate_limit_exceeded',
      isRetryable: true,
      cause: options.cause,
    });
    this.name = 'DeepgramRateLimitError';
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
 * WebSocket configuration
 */
interface WebSocketConfig {
  reconnectAttempts: number;
  reconnectDelay: number;
  pingInterval: number;
  pongTimeout: number;
}

type RealtimeWebSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send: (data: string | Buffer | ArrayBuffer) => void;
  close: () => void;
};

type RealtimeWebSocketConstructor = {
  new (url: string): RealtimeWebSocket;
  OPEN: number;
};

/**
 * Real-time transcription callback
 */
type TranscriptionCallback = (result: {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}) => void;

/**
 * Deepgram Provider Implementation
 */
export class DeepgramProvider implements AIProvider {
  readonly name = 'deepgram';
  readonly supportedModels = [
    'nova-2',
    'nova-2-general',
    'nova-2-meeting',
    'nova-2-phonecall',
    'nova-2-finance',
    'nova-2-conversationalai',
    'nova-2-voicemail',
    'nova-2-medical',
    'nova-2-drivethru',
    'nova-2-automotive',
    'nova',
    'enhanced',
    'base',
  ];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;
  private readonly wsConfig: WebSocketConfig;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.deepgram.com';
    this.defaultModel = config.defaultModel || 'nova-2';
    this.timeout = config.timeout || 30000;
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: 1000,
      maxDelay: 30000,
    };
    this.wsConfig = {
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      pingInterval: 30000,
      pongTimeout: 10000,
    };
  }

  /**
   * Get common headers for Deepgram requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Token ${this.apiKey}`,
    };
  }

  /**
   * Resolve a WebSocket constructor for the current runtime.
   */
  private async resolveWebSocketConstructor(): Promise<RealtimeWebSocketConstructor> {
    const globalWebSocket = globalThis.WebSocket as RealtimeWebSocketConstructor | undefined;
    if (globalWebSocket) {
      return globalWebSocket;
    }

    try {
      const wsModule = (await import('ws')) as { WebSocket: RealtimeWebSocketConstructor };
      if (wsModule.WebSocket) {
        return wsModule.WebSocket;
      }
    } catch (error) {
      throw new DeepgramProviderError({
        message: 'WebSocket is not available in this runtime',
        errorCode: 'websocket_unavailable',
        isRetryable: false,
        cause: error instanceof Error ? error : undefined,
      });
    }

    throw new DeepgramProviderError({
      message: 'WebSocket is not available in this runtime',
      errorCode: 'websocket_unavailable',
      isRetryable: false,
    });
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
        const errorData = (await response.json().catch(() => null)) as DeepgramError | null;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new DeepgramRateLimitError({
            message: errorData?.err_msg || 'Rate limit exceeded',
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
          });
        }

        throw new DeepgramProviderError({
          message: errorData?.err_msg || `HTTP ${response.status}`,
          statusCode: response.status,
          errorCode: errorData?.err_code,
          isRetryable: response.status >= 500,
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof DeepgramProviderError || error instanceof DeepgramRateLimitError) {
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
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number, error?: Error): number {
    if (error instanceof DeepgramRateLimitError && error.retryAfter) {
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
   * Create WebSocket URL with query parameters
   */
  private createWebSocketUrl(options?: TranscribeOptions): string {
    const params = new URLSearchParams();

    params.set('model', options?.model || this.defaultModel);

    if (options?.language) {
      params.set('language', options.language);
    }

    if (options?.punctuate !== undefined) {
      params.set('punctuate', String(options.punctuate));
    }

    if (options?.smart_format !== undefined) {
      params.set('smart_format', String(options.smart_format));
    }

    if (options?.diarize !== undefined) {
      params.set('diarize', String(options.diarize));
    }

    if (options?.multichannel !== undefined) {
      params.set('multichannel', String(options.multichannel));
    }

    if (options?.interim_results !== undefined) {
      params.set('interim_results', String(options.interim_results));
    }

    if (options?.endpointing !== undefined) {
      params.set('endpointing', options.endpointing);
    }

    if (options?.vad_events !== undefined) {
      params.set('vad_events', String(options.vad_events));
    }

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  /**
   * Create real-time WebSocket transcription session
   */
  async createRealtimeSession(
    options?: TranscribeOptions & {
      onTranscription?: TranscriptionCallback;
      onError?: (error: Error) => void;
      onClose?: () => void;
    }
  ): Promise<{
    send: (audio: Buffer | ArrayBuffer) => void;
    close: () => void;
    getState: () => WebSocketState;
  }> {
    const WebSocketConstructor = await this.resolveWebSocketConstructor();
    let ws: RealtimeWebSocket | null = null;
    let state: WebSocketState = WebSocketState.CLOSED;
    let reconnectAttempts = 0;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const wsUrl = this.createWebSocketUrl(options);

    const connect = () => {
      state = WebSocketState.CONNECTING;
      ws = new WebSocketConstructor(wsUrl);

      ws.onopen = () => {
        state = WebSocketState.OPEN;
        reconnectAttempts = 0;

        // Setup ping/pong for connection health
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocketConstructor.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));

            pongTimeout = setTimeout(() => {
              if (ws) {
                ws.close();
              }
            }, this.wsConfig.pongTimeout);
          }
        }, this.wsConfig.pingInterval);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString()) as DeepgramWebSocketMessage;

          // Clear pong timeout on any message
          if (pongTimeout) {
            clearTimeout(pongTimeout);
            pongTimeout = null;
          }

          switch (data.type) {
            case 'Results':
              if (data.channel?.alternatives && options?.onTranscription) {
                const alt = data.channel.alternatives[0];
                options.onTranscription({
                  transcript: alt.transcript,
                  isFinal: data.is_final || false,
                  confidence: alt.confidence,
                  words: alt.words || [],
                });
              }
              break;

            case 'Error':
              if (options?.onError) {
                options.onError(
                  new DeepgramProviderError({
                    message: data.error || 'Unknown WebSocket error',
                    isRetryable: true,
                  })
                );
              }
              break;

            case 'Close':
              // Server requested close
              break;
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      };

      ws.onerror = (_event) => {
        if (options?.onError) {
          options.onError(
            new DeepgramProviderError({
              message: 'WebSocket error',
              isRetryable: true,
            })
          );
        }
      };

      ws.onclose = (_event) => {
        state = WebSocketState.CLOSED;

        // Clear intervals
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        if (pongTimeout) {
          clearTimeout(pongTimeout);
          pongTimeout = null;
        }

        // Attempt reconnection if not intentionally closed
        if (reconnectAttempts < this.wsConfig.reconnectAttempts) {
          reconnectAttempts++;
          const delay = this.wsConfig.reconnectDelay * Math.pow(2, reconnectAttempts - 1);
          setTimeout(() => {
            connect();
          }, delay);
        } else if (options?.onClose) {
          options.onClose();
        }
      };
    };

    // Initial connection
    connect();

    return {
      send: (audio: Buffer | ArrayBuffer) => {
        if (ws && ws.readyState === WebSocketConstructor.OPEN) {
          ws.send(audio);
        }
      },
      close: () => {
        reconnectAttempts = this.wsConfig.reconnectAttempts; // Prevent reconnection
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (pongTimeout) {
          clearTimeout(pongTimeout);
        }
        if (ws) {
          ws.close();
          ws = null;
        }
      },
      getState: () => state,
    };
  }

  /**
   * Chat completion
   * Note: Deepgram doesn't provide a chat API
   */
  async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    throw new DeepgramProviderError({
      message:
        'Deepgram does not provide a chat API. Use OpenAI or Anthropic for chat completions.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Streaming chat completion
   * Note: Deepgram doesn't provide a chat API
   */
  // eslint-disable-next-line require-yield
  async *chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<ChatStreamChunk> {
    throw new DeepgramProviderError({
      message:
        'Deepgram does not provide a chat API. Use OpenAI or Anthropic for chat completions.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Speech-to-text transcription (batch)
   */
  async transcribe(
    audio: Buffer | ReadableStream,
    options?: TranscribeOptions
  ): Promise<TranscribeResponse> {
    const url = `${this.baseUrl}/v1/listen`;

    const params = new URLSearchParams();
    params.set('model', options?.model || this.defaultModel);

    if (options?.language) params.set('language', options.language);
    if (options?.punctuate !== undefined) params.set('punctuate', String(options.punctuate));
    if (options?.smart_format !== undefined)
      params.set('smart_format', String(options.smart_format));
    if (options?.diarize !== undefined) params.set('diarize', String(options.diarize));
    if (options?.multichannel !== undefined)
      params.set('multichannel', String(options.multichannel));
    if (options?.paragraphs !== undefined) params.set('paragraphs', String(options.paragraphs));
    if (options?.utterances !== undefined) params.set('utterances', String(options.utterances));

    const headers: Record<string, string> = {
      Authorization: `Token ${this.apiKey}`,
    };

    let body: Uint8Array | Blob;

    if (Buffer.isBuffer(audio)) {
      body = new Uint8Array(audio);
      headers['Content-Type'] = 'audio/*';
    } else {
      const response = new Response(audio);
      body = await response.blob();
    }

    const response = await this.fetchWithRetry<DeepgramSyncResponse>(
      `${url}?${params.toString()}`,
      {
        method: 'POST',
        headers,
        body: body as BodyInit,
      }
    );

    // Extract transcript from response
    const channel = response.results.channels[0];
    const alternative = channel.alternatives[0];

    return {
      text: alternative.transcript,
      language: options?.language,
      duration: response.metadata.duration,
      segments: alternative.paragraphs?.paragraphs.flatMap((p) =>
        p.sentences.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        }))
      ),
    };
  }

  /**
   * Text-to-speech synthesis
   * Note: Deepgram doesn't provide a TTS API
   */
  async speak(_text: string, _options?: SpeakOptions): Promise<SpeakResponse> {
    throw new DeepgramProviderError({
      message:
        'Deepgram does not provide a text-to-speech API. Use OpenAI TTS or another provider for speech synthesis.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Create embeddings
   * Note: Deepgram doesn't provide an embeddings API
   */
  async embed(_text: string, _options?: EmbedOptions): Promise<EmbedResponse> {
    throw new DeepgramProviderError({
      message:
        'Deepgram does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
      statusCode: 501,
      errorCode: 'not_implemented',
      isRetryable: false,
    });
  }

  /**
   * Create embeddings for multiple texts
   * Note: Deepgram doesn't provide an embeddings API
   */
  async embedBatch(_texts: string[], _options?: EmbedBatchOptions): Promise<EmbedBatchResponse> {
    throw new DeepgramProviderError({
      message:
        'Deepgram does not provide an embeddings API. Use OpenAI or another provider for embeddings.',
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
      const url = `${this.baseUrl}/v1/projects`;
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
