/**
 * File Upload Service
 *
 * Handles file uploads using Multer with:
 * - File type validation (PDF, DOCX)
 * - File size limits
 * - Unique file naming
 * - Storage management
 */

import multer, { StorageEngine } from 'multer';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { Request } from 'express';
import { UploadedFile, PipelineOptions } from './types';

/**
 * Default pipeline options
 */
const DEFAULT_OPTIONS: Required<PipelineOptions> = {
  chunkSize: 1000,
  chunkOverlap: 200,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  storagePath: './uploads',
};

/**
 * File Upload Service
 */
export class FileUploadService {
  private storage: StorageEngine;
  private options: Required<PipelineOptions>;

  constructor(options: PipelineOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.storage = this.createStorage();
  }

  /**
   * Create Multer storage engine
   */
  private createStorage(): StorageEngine {
    return multer.diskStorage({
      destination: async (
        _req: Request,
        _file: Express.Multer.File,
        cb: (error: Error | null, destination: string) => void
      ) => {
        try {
          await fs.mkdir(this.options.storagePath, { recursive: true });
          cb(null, this.options.storagePath);
        } catch (error) {
          cb(error as Error, '');
        }
      },
      filename: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, filename: string) => void
      ) => {
        const ext = path.extname(file.originalname);
        const fileId = randomUUID();
        const filename = `${fileId}${ext}`;
        cb(null, filename);
      },
    });
  }

  /**
   * File filter for Multer
   */
  private fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ): void => {
    if (this.options.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type: ${file.mimetype}. Allowed types: ${this.options.allowedMimeTypes.join(', ')}`
        )
      );
    }
  };

  /**
   * Get Multer upload middleware
   */
  getUploadMiddleware() {
    return multer({
      storage: this.storage,
      fileFilter: this.fileFilter,
      limits: {
        fileSize: this.options.maxFileSize,
      },
    });
  }

  /**
   * Process uploaded file
   */
  processUploadedFile(file: Express.Multer.File): UploadedFile {
    const fileId = path.basename(file.filename, path.extname(file.filename));

    return {
      id: fileId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: file.path,
      uploadedAt: new Date(),
    };
  }

  /**
   * Delete uploaded file
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get file info
   */
  async getFileInfo(filePath: string): Promise<{ size: number; exists: boolean }> {
    try {
      const stats = await fs.stat(filePath);
      return { size: stats.size, exists: true };
    } catch {
      return { size: 0, exists: false };
    }
  }

  /**
   * Get options
   */
  getOptions(): Required<PipelineOptions> {
    return { ...this.options };
  }
}

/**
 * Create file upload service
 */
export function createFileUploadService(options?: PipelineOptions): FileUploadService {
  return new FileUploadService(options);
}
