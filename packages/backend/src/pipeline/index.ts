/**
 * File Upload and Processing Pipeline
 *
 * Features:
 * - File upload with Multer (PDF, DOCX)
 * - Text extraction from PDF/DOCX
 * - Text chunking for AI processing
 * - Async job processing via Redis queue
 * - Status tracking and notifications
 */

export { FileUploadService, createFileUploadService } from './upload';
export { TextExtractionService, createTextExtractionService } from './extraction';
export { TextChunkingService, createTextChunkingService } from './chunking';
export { QueueService, createQueueService } from './queue';
export { PipelineService, createPipelineService } from './pipeline';
export { pipelineRoutes } from './routes';

export type {
  UploadedFile,
  ExtractionResult,
  TextChunk,
  PipelineJob,
  JobStatus,
  PipelineOptions,
} from './types';
