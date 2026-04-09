'use client';

import { useState, useCallback, useRef, DragEvent, ChangeEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { apiClient } from '../../lib/api-client';

interface UserInfo {
  id: string;
  email: string;
  role: string;
}

interface UploadJob {
  id: string;
  fileName: string;
  status: 'uploading' | 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  fileId?: string;
  chunks?: {
    count: number;
    totalTokens: number;
  };
}

export default function UploadPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function verifyAuth() {
      try {
        const response = await apiClient.getCurrentUser();
        setUser(response.user);
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    verifyAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  }, []);

  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);

    for (const file of files) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create initial job
      const newJob: UploadJob = {
        id: jobId,
        fileName: file.name,
        status: 'uploading',
        progress: 0,
      };

      setJobs((prev) => [...prev, newJob]);

      try {
        const response = await apiClient.uploadFile(file);

        // Update job with backend job ID and start polling
        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? { ...job, id: response.jobId, status: 'pending' as const, progress: 0 }
              : job
          )
        );

        // Start polling for status
        pollJobStatus(response.jobId);
      } catch (error) {
        console.error('Upload error:', error);
        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: 'failed',
                  error: error instanceof Error ? error.message : 'Upload failed',
                }
              : job
          )
        );
      }
    }

    setIsUploading(false);
  };

  const pollJobStatus = useCallback(async (jobId: string) => {
    const poll = async () => {
      try {
        const response = await apiClient.getJobStatus(jobId);

        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: response.status,
                  progress: response.progress || 0,
                  fileId: response.result?.fileId,
                  chunks: response.result?.chunks,
                  error: response.error,
                }
              : job
          )
        );

        // Continue polling if not completed or failed
        if (response.status !== 'completed' && response.status !== 'failed') {
          setTimeout(poll, 2000); // Poll every 2 seconds
        }
      } catch (error) {
        console.error('Status poll error:', error);
        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: 'failed',
                  error: error instanceof Error ? error.message : 'Status check failed',
                }
              : job
          )
        );
      }
    };

    poll();
  }, []);

  const getStatusIcon = (status: UploadJob['status']) => {
    switch (status) {
      case 'uploading':
      case 'pending':
      case 'processing':
        return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: UploadJob['status']) => {
    switch (status) {
      case 'uploading':
      case 'pending':
      case 'processing':
        return 'text-blue-600';
      case 'completed':
        return 'text-green-600';
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getProgressColor = (status: UploadJob['status']) => {
    switch (status) {
      case 'uploading':
      case 'pending':
      case 'processing':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">File Upload</h1>
            <p className="text-gray-600">
              Upload documents for AI processing. Files will be extracted, chunked, and prepared for
              chat interactions.
            </p>
          </div>

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <div className="text-lg font-medium text-gray-900 mb-2">
              {isDragOver ? 'Drop files here' : 'Drag and drop files here'}
            </div>
            <p className="text-gray-500 mb-4">or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              disabled={isUploading}
            >
              Select Files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.doc,.docx,.md"
              onChange={handleFileSelect}
              className="hidden"
            />
            <p className="text-sm text-gray-500 mt-4">Supported formats: PDF, TXT, DOC, DOCX, MD</p>
          </div>

          {/* Jobs List */}
          {jobs.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload Jobs</h2>
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div key={job.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <p className="font-medium text-gray-900">{job.fileName}</p>
                          <p className={`text-sm ${getStatusColor(job.status)}`}>
                            {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                            {job.chunks &&
                              ` • ${job.chunks.count} chunks • ${job.chunks.totalTokens} tokens`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">{job.progress}%</p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(job.status)}`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>

                    {/* Error Message */}
                    {job.error && <p className="text-sm text-red-600 mt-2">{job.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
