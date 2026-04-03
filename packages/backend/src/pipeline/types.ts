/**
 * Pipeline Type Definitions
 */

/**
 * Uploaded file information
 */
export interface UploadedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: Date;
}

/**
 * Text extraction result
 */
export interface ExtractionResult {
  fileId: string;
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
  extractedAt: Date;
}

/**
 * Text chunk for AI processing
 */
export interface TextChunk {
  id: string;
  fileId: string;
  index: number;
  text: string;
  startChar: number;
  endChar: number;
  tokenCount?: number;
}

/**
 * Job status
 */
export type JobStatus =
  | 'pending'
  | 'uploading'
  | 'extracting'
  | 'chunking'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Pipeline job
 */
export interface PipelineJob {
  id: string;
  fileId: string;
  status: JobStatus;
  progress: number;
  chunks?: TextChunk[];
  error?: string;
  result?: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Pipeline options
 */
export interface PipelineOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  storagePath?: string;
}

/**
 * Queue job data
 */
export interface QueueJobData {
  jobId: string;
  fileId: string;
  filePath: string;
  mimeType: string;
  options: PipelineOptions;
  originalJobId?: string;
  error?: string;
  failedAt?: string;
}

/**
 * Queue job result
 */
export interface QueueJobResult {
  jobId: string;
  success: boolean;
  chunks?: TextChunk[];
  error?: string;
}
