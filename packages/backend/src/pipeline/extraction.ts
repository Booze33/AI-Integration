/**
 * Text Extraction Service
 *
 * Extracts text from PDF and DOCX files using:
 * - pdf-parse for PDF files
 * - mammoth for DOCX files
 */

import * as pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs/promises';
import { ExtractionResult } from './types';

/**
 * Text Extraction Service
 */
export class TextExtractionService {
  /**
   * Extract text from a file
   */
  async extractText(fileId: string, filePath: string, mimeType: string): Promise<ExtractionResult> {
    const buffer = await fs.readFile(filePath);

    switch (mimeType) {
      case 'application/pdf':
        return this.extractFromPdf(fileId, buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.extractFromDocx(fileId, buffer);
      default:
        throw new Error(`Unsupported file type: ${mimeType}`);
    }
  }

  /**
   * Extract text from PDF
   */
  private async extractFromPdf(fileId: string, buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await (pdfParse as any)(buffer);
      return {
        fileId,
        text: result.text || '',
        pageCount: result.numpages,
        metadata: {
          info: result.info,
          metadata: result.metadata,
        },
        extractedAt: new Date(),
      };
    } catch (error) {
      const message = `Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`;
      const newError = new Error(message);
      (newError as any).cause = error;
      throw newError;
    }
  }

  /**
   * Extract text from DOCX
   */
  private async extractFromDocx(fileId: string, buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });

      return {
        fileId,
        text: result.value,
        metadata: {
          messages: result.messages,
        },
        extractedAt: new Date(),
      };
    } catch (error) {
      const message = `Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`;
      const newError = new Error(message);
      (newError as any).cause = error;
      throw newError;
    }
  }

  /**
   * Extract text with progress callback
   */
  async extractTextWithProgress(
    fileId: string,
    filePath: string,
    mimeType: string,
    onProgress?: (progress: number) => void
  ): Promise<ExtractionResult> {
    onProgress?.(0);
    onProgress?.(50);

    const result = await this.extractText(fileId, filePath, mimeType);
    onProgress?.(100);

    return result;
  }

  /**
   * Validate file before extraction
   */
  async validateFile(filePath: string, mimeType: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);

      if (stats.size === 0) {
        return false;
      }

      // Check file extension matches mime type
      const ext = filePath.toLowerCase().split('.').pop();
      const validExtensions: Record<string, string[]> = {
        'application/pdf': ['pdf'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
      };

      const expectedExtensions = validExtensions[mimeType];
      if (expectedExtensions && !expectedExtensions.includes(ext || '')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create text extraction service
 */
export function createTextExtractionService(): TextExtractionService {
  return new TextExtractionService();
}
