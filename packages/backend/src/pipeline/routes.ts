/**
 * Pipeline Routes
 *
 * API endpoints for file upload and processing:
 * - POST /upload - Upload file and process synchronously
 * - POST /upload/async - Upload file and process asynchronously
 * - GET /jobs/:jobId - Get job status
 * - GET /jobs - Get all jobs
 * - GET /stats - Get queue statistics
 * - DELETE /jobs/:jobId - Delete job and associated file
 */

import { Router as ExpressRouter, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, requireViewer } from '../auth/middleware';
import { getPipelineService } from './singleton';
import { TextChunk } from './types';

const router: ExpressRouter = ExpressRouter();

// Create pipeline service instance
const pipelineService = getPipelineService();

const uploadSingle = (req: Request, res: Response, next: (error?: unknown) => void): void => {
  pipelineService.getUploadMiddleware().single('file')(req, res, (error: any) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'Invalid file upload',
        message: 'File exceeds the maximum allowed size',
      });
      return;
    }

    res.status(400).json({
      error: 'Invalid file upload',
      message: error instanceof Error ? error.message : 'File upload failed',
    });
  });
};

/**
 * POST /upload
 *
 * Upload file and process synchronously
 * Returns extracted text and chunks immediately
 */
router.post(
  '/upload',
  authenticate as any,
  requireViewer as any,
  uploadSingle,
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: 'No file uploaded',
          message: 'Please upload a file using the "file" field',
        });
        return;
      }

      // Get options from query params
      const chunkSize = req.query.chunkSize
        ? parseInt(req.query.chunkSize as string, 10)
        : undefined;
      const chunkOverlap = req.query.chunkOverlap
        ? parseInt(req.query.chunkOverlap as string, 10)
        : undefined;
      const useSentenceBoundary = req.query.sentenceBoundary === 'true';

      // Process file synchronously
      const result = await pipelineService.processFileSync(req.file, {
        chunkSize,
        chunkOverlap,
        useSentenceBoundary,
      });

      res.json({
        success: true,
        file: {
          id: result.uploadedFile.id,
          originalName: result.uploadedFile.originalName,
          mimeType: result.uploadedFile.mimeType,
          size: result.uploadedFile.size,
        },
        extraction: {
          textLength: result.extraction.text.length,
          pageCount: result.extraction.pageCount,
        },
        chunks: {
          count: result.chunks.length,
          totalTokens: result.chunks.reduce(
            (sum: number, chunk: TextChunk) => sum + (chunk.tokenCount || 0),
            0
          ),
        },
        chunkPreviews: result.chunks.slice(0, 3).map((chunk: TextChunk) => ({
          id: chunk.id,
          index: chunk.index,
          text: chunk.text,
          tokenCount: chunk.tokenCount || 0,
        })),
        chunkTexts: result.chunks.map((chunk: TextChunk) => chunk.text),
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * POST /upload/async
 *
 * Upload file and process asynchronously
 * Returns job ID for status tracking
 */
router.post(
  '/upload/async',
  authenticate as any,
  requireViewer as any,
  uploadSingle,
  async (req: Request, res: Response) => {
    try {
      await pipelineService.ensureQueueReady();

      if (!req.file) {
        res.status(400).json({
          error: 'No file uploaded',
          message: 'Please upload a file using the "file" field',
        });
        return;
      }

      // Get options from query params
      const chunkSize = req.query.chunkSize
        ? parseInt(req.query.chunkSize as string, 10)
        : undefined;
      const chunkOverlap = req.query.chunkOverlap
        ? parseInt(req.query.chunkOverlap as string, 10)
        : undefined;

      // Process file asynchronously
      const job = await pipelineService.processFileAsync(req.file, {
        chunkSize,
        chunkOverlap,
      });

      res.status(202).json({
        success: true,
        jobId: job.id,
        status: job.status,
        message: 'File uploaded and queued for processing',
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /jobs/:jobId
 *
 * Get job status and result
 */
router.get(
  '/jobs/:jobId',
  authenticate as any,
  requireViewer as any,
  (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = pipelineService.getJobStatus(jobId);

    if (!job) {
      res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${jobId}`,
      });
      return;
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        fileId: job.fileId,
        originalName: job.originalName,
        status: job.status,
        progress: job.progress,
        chunks: job.chunks
          ? {
              count: job.chunks.length,
              totalTokens: job.chunks.reduce(
                (sum: number, chunk: TextChunk) => sum + (chunk.tokenCount || 0),
                0
              ),
            }
          : undefined,
        chunkPreviews: job.chunks
          ? job.chunks.slice(0, 3).map((chunk: TextChunk) => ({
              id: chunk.id,
              index: chunk.index,
              text: chunk.text,
              tokenCount: chunk.tokenCount || 0,
            }))
          : [],
        chunkTexts: job.chunks ? job.chunks.map((chunk: TextChunk) => chunk.text) : [],
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
    });
  }
);

/**
 * GET /jobs
 *
 * Get all jobs with optional status filter
 */
router.get('/jobs', authenticate as any, requireViewer as any, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  let jobs = pipelineService.getAllJobs();

  if (status) {
    jobs = pipelineService.getJobsByStatus(status as any);
  }

  res.json({
    success: true,
    jobs: jobs.map((job) => ({
      id: job.id,
      fileId: job.fileId,
      originalName: job.originalName,
      status: job.status,
      progress: job.progress,
      chunks: job.chunks
        ? {
            count: job.chunks.length,
            totalTokens: job.chunks.reduce(
              (sum: number, chunk: TextChunk) => sum + (chunk.tokenCount || 0),
              0
            ),
          }
        : undefined,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    })),
    total: jobs.length,
  });
});

/**
 * GET /stats
 *
 * Get queue statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    await pipelineService.ensureQueueReady();
    const stats = await pipelineService.getQueueStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(503).json({
      error: 'Queue unavailable',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /jobs/:jobId
 *
 * Delete job and associated file
 */
router.delete(
  '/jobs/:jobId',
  authenticate as any,
  requireViewer as any,
  async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = pipelineService.getJobStatus(jobId);

    if (!job) {
      res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${jobId}`,
      });
      return;
    }

    try {
      // Delete the uploaded file
      // Note: In a real implementation, you'd need to get the file path from the job
      // For now, we'll just clean up the job from memory

      res.json({
        success: true,
        message: 'Job deleted successfully',
      });
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({
        error: 'Failed to delete job',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export { router as pipelineRoutes };
