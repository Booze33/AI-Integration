import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createFileUploadService } from '../upload';

describe('FileUploadService', () => {
  let app: express.Application;
  let storagePath: string;

  beforeEach(async () => {
    storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-upload-'));

    const uploadService = createFileUploadService({
      storagePath,
      maxFileSize: 5 * 1024 * 1024,
    });

    app = express();
    app.post('/upload', uploadService.getUploadMiddleware().single('file'), (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const uploadedFile = uploadService.processUploadedFile(req.file);
      res.status(200).json({
        destination: req.file.destination,
        path: req.file.path,
        uploadedFile,
      });
    });
  });

  afterEach(async () => {
    await fs.rm(storagePath, { recursive: true, force: true });
  });

  it('saves uploaded file to configured storagePath', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    const savedFilePath = response.body.path as string;
    const savedFileName = path.basename(savedFilePath);
    const uuidWithExtPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

    expect(path.resolve(response.body.destination)).toBe(path.resolve(storagePath));
    expect(path.resolve(path.dirname(savedFilePath))).toBe(path.resolve(storagePath));
    expect(savedFileName).toMatch(uuidWithExtPattern);
    expect(savedFileName).not.toBe('test.pdf');

    const fileStats = await fs.stat(savedFilePath);
    expect(fileStats.isFile()).toBe(true);
  });
});
