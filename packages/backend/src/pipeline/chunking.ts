/**
 * Text Chunking Service
 *
 * Splits extracted text into chunks for AI processing with:
 * - Configurable chunk size
 * - Overlap between chunks
 * - Token counting (optional)
 */

import { TextChunk } from './types';

/**
 * Default chunking options
 */
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Text Chunking Service
 */
export class TextChunkingService {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    chunkOverlap: number = DEFAULT_CHUNK_OVERLAP
  ) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;

    if (chunkOverlap >= chunkSize) {
      throw new Error('Chunk overlap must be less than chunk size');
    }
  }

  /**
   * Split text into chunks
   */
  chunkText(fileId: string, text: string): TextChunk[] {
    if (!text || text.length === 0) {
      return [];
    }

    const chunks: TextChunk[] = [];
    const step = this.chunkSize - this.chunkOverlap;
    let index = 0;
    let startChar = 0;

    while (startChar < text.length) {
      const endChar = Math.min(startChar + this.chunkSize, text.length);
      const chunkText = text.slice(startChar, endChar);

      // Skip empty chunks
      if (chunkText.trim().length > 0) {
        chunks.push({
          id: `${fileId}-chunk-${index}`,
          fileId,
          index,
          text: chunkText,
          startChar,
          endChar,
          tokenCount: this.estimateTokenCount(chunkText),
        });
        index++;
      }

      // Move to next chunk
      startChar += step;

      // Break if we've reached the end
      if (endChar >= text.length) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Chunk text with sentence boundary awareness
   */
  chunkTextWithSentences(fileId: string, text: string): TextChunk[] {
    if (!text || text.length === 0) {
      return [];
    }

    const chunks: TextChunk[] = [];
    const sentences = this.splitIntoSentences(text);
    let currentChunk = '';
    let currentStartChar = 0;
    let index = 0;

    for (const sentence of sentences) {
      // Check if adding this sentence exceeds chunk size
      if (currentChunk.length + sentence.length > this.chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          id: `${fileId}-chunk-${index}`,
          fileId,
          index,
          text: currentChunk.trim(),
          startChar: currentStartChar,
          endChar: currentStartChar + currentChunk.length,
          tokenCount: this.estimateTokenCount(currentChunk),
        });

        // Start new chunk with overlap
        const overlapStart = Math.max(0, currentChunk.length - this.chunkOverlap);
        currentChunk = currentChunk.slice(overlapStart) + sentence;
        currentStartChar += overlapStart;
        index++;
      } else {
        currentChunk += sentence;
      }
    }

    // Add final chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: `${fileId}-chunk-${index}`,
        fileId,
        index,
        text: currentChunk.trim(),
        startChar: currentStartChar,
        endChar: currentStartChar + currentChunk.length,
        tokenCount: this.estimateTokenCount(currentChunk),
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - can be improved with NLP libraries
    const sentenceEnders = /[.!?]+/g;
    const sentences: string[] = [];
    let lastIndex = 0;

    let match;
    while ((match = sentenceEnders.exec(text)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = text.slice(lastIndex, endIndex);
      if (sentence.trim().length > 0) {
        sentences.push(sentence + ' ');
      }
      lastIndex = endIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining.trim().length > 0) {
        sentences.push(remaining);
      }
    }

    return sentences;
  }

  /**
   * Estimate token count (rough approximation)
   * ~4 characters per token for English text
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get chunking options
   */
  getOptions(): { chunkSize: number; chunkOverlap: number } {
    return {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    };
  }
}

/**
 * Create text chunking service
 */
export function createTextChunkingService(
  chunkSize?: number,
  chunkOverlap?: number
): TextChunkingService {
  return new TextChunkingService(chunkSize, chunkOverlap);
}
