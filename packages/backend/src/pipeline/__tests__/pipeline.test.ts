/**
 * Pipeline Tests
 *
 * Tests for the file upload and processing pipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import { pipelineRoutes } from '../routes';

vi.mock('../../auth/middleware', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));

// Mock the pipeline service
vi.mock('../pipeline', () => ({
  createPipelineService: vi.fn(() => ({
    getUploadMiddleware: vi.fn(() => ({
      single: vi.fn(() => (req: any, res: any, next: any) => {
        if (req.headers['x-test-file-type'] === 'oversize') {
          next(new multer.MulterError('LIMIT_FILE_SIZE'));
          return;
        }

        if (req.headers['x-test-file-type'] === 'invalid') {
          next(
            new Error(
              'Invalid file type: text/plain. Allowed types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            )
          );
          return;
        }

        // Check if file was attached by looking at content-type header
        if (req.headers['content-type']?.includes('multipart/form-data')) {
          const isDocx = req.headers['x-test-file-type'] === 'docx';
          const mimeType = isDocx
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';
          const extension = isDocx ? 'docx' : 'pdf';

          // Simulate file upload only if content-type is multipart
          req.file = {
            fieldname: 'file',
            originalname: `test.${extension}`,
            encoding: '7bit',
            mimetype: mimeType,
            destination: './uploads',
            filename: `test-file-id.${extension}`,
            path: `./uploads/test-file-id.${extension}`,
            size: 1024,
          };
        }
        next();
      }),
    })),
    processFileSync: vi.fn(async (file: any) => ({
      uploadedFile: {
        id: 'test-file-id',
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: 1024,
        path: file.path,
        uploadedAt: new Date(),
      },
      extraction: {
        fileId: 'test-file-id',
        text: 'This is extracted text from the PDF file.',
        pageCount: 1,
        extractedAt: new Date(),
      },
      chunks: [
        {
          id: 'test-file-id-chunk-0',
          fileId: 'test-file-id',
          index: 0,
          text: 'This is extracted text from the PDF file.',
          startChar: 0,
          endChar: 42,
          tokenCount: 11,
        },
      ],
    })),
    processFileAsync: vi.fn(async () => ({
      id: 'job-test-file-id',
      fileId: 'test-file-id',
      originalName: 'test.pdf',
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getJobStatus: vi.fn((jobId) => {
      if (jobId === 'job-test-file-id') {
        return {
          id: 'job-test-file-id',
          fileId: 'test-file-id',
          originalName: 'test.pdf',
          status: 'completed',
          progress: 100,
          chunks: [
            {
              id: 'test-file-id-chunk-0',
              fileId: 'test-file-id',
              index: 0,
              text: 'This is extracted text from the PDF file.',
              startChar: 0,
              endChar: 42,
              tokenCount: 11,
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        };
      }
      return undefined;
    }),
    getAllJobs: vi.fn(() => [
      {
        id: 'job-test-file-id',
        fileId: 'test-file-id',
        originalName: 'test.pdf',
        status: 'completed',
        progress: 100,
        chunks: [
          {
            id: 'test-file-id-chunk-0',
            fileId: 'test-file-id',
            index: 0,
            text: 'This is extracted text from the PDF file.',
            startChar: 0,
            endChar: 42,
            tokenCount: 11,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    ]),
    getJobsByStatus: vi.fn((status) => {
      if (status === 'completed') {
        return [
          {
            id: 'job-test-file-id',
            fileId: 'test-file-id',
            originalName: 'test.pdf',
            status: 'completed',
            progress: 100,
            chunks: [
              {
                id: 'test-file-id-chunk-0',
                fileId: 'test-file-id',
                index: 0,
                text: 'This is extracted text from the PDF file.',
                startChar: 0,
                endChar: 42,
                tokenCount: 11,
              },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: new Date(),
          },
        ];
      }
      return [];
    }),
    getQueueStats: vi.fn(async () => ({
      waiting: 0,
      active: 1,
      completed: 5,
      failed: 0,
      delayed: 0,
    })),
    ensureQueueReady: vi.fn(async () => undefined),
  })),
}));

describe('Pipeline Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/pipeline', pipelineRoutes);
  });

  describe('POST /api/pipeline/upload', () => {
    it('should upload and process file synchronously', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload')
        .attach('file', Buffer.from('test pdf content'), 'test.pdf')
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          file: {
            id: expect.any(String),
            originalName: 'test.pdf',
            mimeType: 'application/pdf',
            size: expect.any(Number),
          },
          extraction: {
            textLength: expect.any(Number),
            pageCount: expect.any(Number),
          },
          chunks: {
            count: expect.any(Number),
            totalTokens: expect.any(Number),
          },
          chunkPreviews: expect.any(Array),
          chunkTexts: expect.any(Array),
        })
      );
    });

    it('should upload DOCX and return extraction and chunk metadata', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload')
        .set('x-test-file-type', 'docx')
        .attach('file', Buffer.from('test docx content'), 'test.docx')
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          file: {
            id: expect.any(String),
            originalName: 'test.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: expect.any(Number),
          },
          extraction: {
            textLength: expect.any(Number),
            pageCount: expect.any(Number),
          },
          chunks: {
            count: expect.any(Number),
            totalTokens: expect.any(Number),
          },
          chunkPreviews: expect.any(Array),
          chunkTexts: expect.any(Array),
        })
      );
    });

    it('should return 400 with clear error for invalid file type', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload')
        .set('x-test-file-type', 'invalid')
        .attach('file', Buffer.from('plain text content'), 'test.txt')
        .expect(400);

      expect(response.body).toEqual(
        expect.objectContaining({
          error: 'Invalid file upload',
          message: expect.stringContaining('Invalid file type'),
        })
      );
    });

    it('should return 400 if uploaded file exceeds size limit', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload')
        .set('x-test-file-type', 'oversize')
        .attach('file', Buffer.from('x'), 'big.pdf')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid file upload',
        message: 'File exceeds the maximum allowed size',
      });
    });

    it('should return 400 if no file uploaded', async () => {
      const response = await request(app).post('/api/pipeline/upload').expect(400);

      expect(response.body).toEqual({
        error: 'No file uploaded',
        message: 'Please upload a file using the "file" field',
      });
    });

    it('should accept custom chunk size and overlap', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload?chunkSize=500&chunkOverlap=100')
        .attach('file', Buffer.from('test pdf content'), 'test.pdf')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should accept sentence boundary option', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload?sentenceBoundary=true')
        .attach('file', Buffer.from('test pdf content'), 'test.pdf')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/pipeline/upload/async', () => {
    it('should upload and process file asynchronously', async () => {
      const response = await request(app)
        .post('/api/pipeline/upload/async')
        .attach('file', Buffer.from('test pdf content'), 'test.pdf')
        .expect(202);

      expect(response.body).toEqual({
        success: true,
        jobId: expect.any(String),
        status: 'pending',
        message: 'File uploaded and queued for processing',
      });
    });

    it('should return 400 if no file uploaded', async () => {
      const response = await request(app).post('/api/pipeline/upload/async').expect(400);

      expect(response.body).toEqual({
        error: 'No file uploaded',
        message: 'Please upload a file using the "file" field',
      });
    });
  });

  describe('GET /api/pipeline/jobs/:jobId', () => {
    it('should return job status', async () => {
      const response = await request(app).get('/api/pipeline/jobs/job-test-file-id').expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          job: expect.objectContaining({
            id: 'job-test-file-id',
            fileId: 'test-file-id',
            originalName: 'test.pdf',
            status: 'completed',
            progress: 100,
            chunks: {
              count: 1,
              totalTokens: 11,
            },
            chunkPreviews: expect.any(Array),
            chunkTexts: expect.any(Array),
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            completedAt: expect.any(String),
          }),
        })
      );
    });

    it('should return 404 for unknown job', async () => {
      const response = await request(app).get('/api/pipeline/jobs/unknown-job-id').expect(404);

      expect(response.body).toEqual({
        error: 'Job not found',
        message: 'No job found with ID: unknown-job-id',
      });
    });
  });

  describe('GET /api/pipeline/jobs', () => {
    it('should return all jobs', async () => {
      const response = await request(app).get('/api/pipeline/jobs').expect(200);

      expect(response.body).toEqual({
        success: true,
        jobs: expect.arrayContaining([
          expect.objectContaining({
            id: 'job-test-file-id',
            originalName: 'test.pdf',
            status: 'completed',
          }),
        ]),
        total: expect.any(Number),
      });
    });

    it('should filter jobs by status', async () => {
      const response = await request(app).get('/api/pipeline/jobs?status=completed').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.jobs.every((job: any) => job.status === 'completed')).toBe(true);
    });
  });

  describe('GET /api/pipeline/stats', () => {
    it('should return queue statistics', async () => {
      const response = await request(app).get('/api/pipeline/stats').expect(200);

      expect(response.body).toEqual({
        success: true,
        stats: {
          waiting: expect.any(Number),
          active: expect.any(Number),
          completed: expect.any(Number),
          failed: expect.any(Number),
          delayed: expect.any(Number),
        },
      });
    });
  });

  describe('DELETE /api/pipeline/jobs/:jobId', () => {
    it('should delete job', async () => {
      const response = await request(app).delete('/api/pipeline/jobs/job-test-file-id').expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Job deleted successfully',
      });
    });

    it('should return 404 for unknown job', async () => {
      const response = await request(app).delete('/api/pipeline/jobs/unknown-job-id').expect(404);

      expect(response.body).toEqual({
        error: 'Job not found',
        message: 'No job found with ID: unknown-job-id',
      });
    });
  });
});
