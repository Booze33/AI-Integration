/**
 * AI Provider Adapter Interface
 *
 * This interface defines the contract that all AI providers must implement.
 * Switching between providers is as simple as changing the AI_PROVIDER environment variable.
 */

// Chat Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ChatResponse {
  id: string;
  message: ChatMessage;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface ChatStreamChunk {
  id: string;
  delta: Partial<ChatMessage>;
  model: string;
  finishReason?: string;
}

// Transcription Types
export interface TranscribeOptions {
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  // Deepgram-specific options
  punctuate?: boolean;
  smart_format?: boolean;
  diarize?: boolean;
  multichannel?: boolean;
  interim_results?: boolean;
  endpointing?: string;
  vad_events?: boolean;
  paragraphs?: boolean;
  utterances?: boolean;
}

export interface TranscribeResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

// Text-to-Speech Types
export interface SpeakOptions {
  model?: string;
  voice?: string;
  speed?: number;
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export interface SpeakResponse {
  audioBuffer: Buffer;
  contentType: string;
  stream?: ReadableStream;
}

// Embedding Types
export interface EmbedOptions {
  model?: string;
}

export interface EmbedResponse {
  embedding: number[];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface EmbedBatchOptions extends EmbedOptions {
  batchSize?: number;
}

export interface EmbedBatchResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Core AI Provider Interface
 *
 * All AI providers must implement this interface to ensure
 * consistent behavior across different services.
 */
export interface AIProvider {
  /**
   * Provider identification
   */
  readonly name: string;
  readonly supportedModels: string[];

  /**
   * Chat completion
   * Generate responses in a conversational context
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * Streaming chat completion
   * Generate responses with streaming support
   */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk>;

  /**
   * Speech-to-text transcription
   * Convert audio to text
   */
  transcribe(
    audio: Buffer | ReadableStream,
    options?: TranscribeOptions
  ): Promise<TranscribeResponse>;

  /**
   * Text-to-speech synthesis
   * Convert text to audio
   */
  speak(text: string, options?: SpeakOptions): Promise<SpeakResponse>;

  /**
   * Create embeddings for a single text
   * Convert text to vector representation
   */
  embed(text: string, options?: EmbedOptions): Promise<EmbedResponse>;

  /**
   * Create embeddings for multiple texts
   * Batch processing for efficiency
   */
  embedBatch(texts: string[], options?: EmbedBatchOptions): Promise<EmbedBatchResponse>;

  /**
   * Health check
   * Verify provider connectivity and configuration
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider Configuration
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Supported provider names
 */
export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'azure-openai'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'ollama'
  | 'deepgram'
  | 'elevenlabs'
  | 'custom';

/**
 * Provider Factory Configuration
 */
export interface ProviderFactoryConfig {
  provider: ProviderName;
  config: ProviderConfig;
}
