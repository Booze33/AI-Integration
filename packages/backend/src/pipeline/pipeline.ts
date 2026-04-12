/**
 * Pipeline Service
 *
 * Orchestrates the file processing pipeline:
 * - File upload
 * - Text extraction
 * - Text chunking
 * - Async job processing
 */

import { FileUploadService } from './upload';
import { TextExtractionService } from './extraction';
import { TextChunkingService } from './chunking';
import { QueueService } from './queue';
import { UploadedFile, ExtractionResult, TextChunk, PipelineJob, PipelineOptions } from './types';

/**
 * Pipeline Service
 */
export class PipelineService {
  private uploadService: FileUploadService;
  private extractionService: TextExtractionService;
  private chunkingService: TextChunkingService;
  private queueService: QueueService;

  constructor(options: PipelineOptions = {}) {
    this.uploadService = new FileUploadService(options);
    this.extractionService = new TextExtractionService();
    this.chunkingService = new TextChunkingService(options.chunkSize, options.chunkOverlap);
    this.queueService = new QueueService();
  }

  /**
   * Get upload middleware
   */
  getUploadMiddleware() {
    return this.uploadService.getUploadMiddleware();
  }

  /**
   * Process uploaded file synchronously
   */
  async processFileSync(
    file: Express.Multer.File,
    options: {
      chunkSize?: number;
      chunkOverlap?: number;
      useSentenceBoundary?: boolean;
    } = {}
  ): Promise<{
    uploadedFile: UploadedFile;
    extraction: ExtractionResult;
    chunks: TextChunk[];
  }> {
    // Process uploaded file
    const uploadedFile = this.uploadService.processUploadedFile(file);

    // Extract text
    const extraction = await this.extractionService.extractText(
      uploadedFile.id,
      uploadedFile.path,
      uploadedFile.mimeType
    );

    // Chunk text
    const chunkingService = options.chunkSize
      ? new TextChunkingService(options.chunkSize, options.chunkOverlap)
      : this.chunkingService;

    const chunks = options.useSentenceBoundary
      ? chunkingService.chunkTextWithSentences(uploadedFile.id, extraction.text)
      : chunkingService.chunkText(uploadedFile.id, extraction.text);

    return {
      uploadedFile,
      extraction,
      chunks,
    };
  }

  /**
   * Process uploaded file asynchronously via queue
   */
  async processFileAsync(
    file: Express.Multer.File,
    options: {
      chunkSize?: number;
      chunkOverlap?: number;
    } = {}
  ): Promise<PipelineJob> {
    // Process uploaded file
    const uploadedFile = this.uploadService.processUploadedFile(file);

    // Add job to queue
    const job = await this.queueService.addJob(
      uploadedFile.id,
      uploadedFile.path,
      uploadedFile.mimeType,
      {
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
      }
    );

    return job;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): PipelineJob | undefined {
    return this.queueService.getJob(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): PipelineJob[] {
    return this.queueService.getAllJobs();
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: PipelineJob['status']): PipelineJob[] {
    return this.queueService.getJobsByStatus(status);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return this.queueService.getStats();
  }

  /**
   * Ensure queue dependencies are ready before queue-backed operations.
   */
  async ensureQueueReady(): Promise<void> {
    await this.queueService.waitUntilReady();
  }

  /**
   * Queue health status used by diagnostics endpoints.
   */
  getQueueHealth() {
    return this.queueService.getHealthStatus();
  }

  /**
   * Clean up old jobs
   */
  async cleanOldJobs(olderThanMs?: number) {
    return this.queueService.cleanOldJobs(olderThanMs);
  }

  /**
   * Delete uploaded file
   */
  async deleteFile(filePath: string): Promise<void> {
    return this.uploadService.deleteFile(filePath);
  }

  /**
   * Get file info
   */
  async getFileInfo(filePath: string) {
    return this.uploadService.getFileInfo(filePath);
  }

  /**
   * Get upload options
   */
  getUploadOptions() {
    return this.uploadService.getOptions();
  }

  /**
   * Get chunking options
   */
  getChunkingOptions() {
    return this.chunkingService.getOptions();
  }

  /**
   * Close services
   */
  async close(): Promise<void> {
    await this.queueService.close();
  }
}

/**
 * Create pipeline service
 */
export function createPipelineService(options?: PipelineOptions): PipelineService {
  return new PipelineService(options);
}
