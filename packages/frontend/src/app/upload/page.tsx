'use client';

import { useState, useCallback, useRef, DragEvent, ChangeEvent, useEffect, useMemo } from 'react';
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
  status:
    | 'queued'
    | 'uploading'
    | 'pending'
    | 'extracting'
    | 'chunking'
    | 'processing'
    | 'completed'
    | 'failed';
  progress: number;
  error?: string;
  fileId?: string;
  chunks?: {
    count: number;
    totalTokens: number;
  };
  chunkPreviews?: Array<{
    id: string;
    index: number;
    text: string;
    tokenCount: number;
  }>;
  chunkTexts?: string[];
  completedAt?: string;
}

type UploadMode = 'sync' | 'background';
type JobFilter = 'all' | 'failed';

const UPLOAD_MODE_STORAGE_KEY = 'uploadProcessingMode';
const CHAT_HISTORY_STORAGE_KEY = 'chatHistory';

function normalizeStatus(status?: string): UploadJob['status'] {
  if (
    status === 'queued' ||
    status === 'uploading' ||
    status === 'pending' ||
    status === 'extracting' ||
    status === 'chunking' ||
    status === 'processing' ||
    status === 'completed' ||
    status === 'failed'
  ) {
    return status;
  }
  return 'pending';
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateTime(value?: string) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

export default function UploadPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode>('background');
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [pipelineStats, setPipelineStats] = useState({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
  });
  const [selectedJob, setSelectedJob] = useState<UploadJob | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [expandedChunkIds, setExpandedChunkIds] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Array<{ tempJobId: string; file: File }>>([]);
  const isQueueRunningRef = useRef(false);
  const zoneErrorTimeoutRef = useRef<number | null>(null);
  const pollingTimersRef = useRef<Record<string, number>>({});

  const visibleJobs = useMemo(() => {
    if (jobFilter === 'failed') {
      return jobs.filter((job) => job.status === 'failed');
    }
    return jobs;
  }, [jobFilter, jobs]);

  const stopPollingJob = useCallback((jobId: string) => {
    const existing = pollingTimersRef.current[jobId];
    if (existing) {
      window.clearInterval(existing);
      delete pollingTimersRef.current[jobId];
    }
  }, []);

  const mergeJobs = useCallback((incoming: UploadJob[]) => {
    setJobs((prev) => {
      const byId = new Map(prev.map((job) => [job.id, job]));
      incoming.forEach((job) => {
        const existing = byId.get(job.id);
        byId.set(job.id, existing ? { ...existing, ...job } : job);
      });
      return Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.id.includes('temp_') ? Date.now() : Date.now()).getTime() -
          new Date(a.id.includes('temp_') ? Date.now() : Date.now()).getTime()
      );
    });
  }, []);

  const pollJobStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await apiClient.getJobStatus(jobId);
        const normalized = normalizeStatus(response.status);

        setJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  fileName: response.fileId || job.fileName,
                  fileId: response.fileId,
                  status: normalized,
                  progress: response.progress || 0,
                  chunks: response.chunks,
                  chunkPreviews: response.chunkPreviews,
                  chunkTexts: response.chunkTexts,
                  error: response.error,
                  completedAt: response.completedAt,
                }
              : job
          )
        );

        if (normalized === 'completed' || normalized === 'failed') {
          stopPollingJob(jobId);
        }
      } catch (error) {
        stopPollingJob(jobId);
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
    },
    [stopPollingJob]
  );

  const startPollingJob = useCallback(
    (jobId: string) => {
      if (pollingTimersRef.current[jobId]) {
        return;
      }

      void pollJobStatus(jobId);
      const timer = window.setInterval(() => {
        void pollJobStatus(jobId);
      }, 2000);
      pollingTimersRef.current[jobId] = timer;
    },
    [pollJobStatus]
  );

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

    const savedMode = localStorage.getItem(UPLOAD_MODE_STORAGE_KEY);
    if (savedMode === 'sync' || savedMode === 'background') {
      setUploadMode(savedMode);
    }

    return () => {
      if (zoneErrorTimeoutRef.current) {
        window.clearTimeout(zoneErrorTimeoutRef.current);
      }
      Object.values(pollingTimersRef.current).forEach((timer) => {
        window.clearInterval(timer);
      });
      pollingTimersRef.current = {};
    };
  }, [router]);

  useEffect(() => {
    async function fetchInitialJobs() {
      try {
        const response = await apiClient.getPipelineJobs();
        const fetchedJobs: UploadJob[] = (response.jobs || []).map((job) => ({
          id: job.jobId,
          fileName: job.fileId || job.jobId,
          fileId: job.fileId,
          status: normalizeStatus(job.status),
          progress: job.progress || 0,
          chunks: job.chunks,
          error: job.error,
        }));
        mergeJobs(fetchedJobs);
      } catch (error) {
        console.error('Failed to fetch initial jobs:', error);
      }
    }

    if (user) {
      void fetchInitialJobs();
    }
  }, [mergeJobs, user]);

  useEffect(() => {
    let isMounted = true;

    async function fetchStats() {
      try {
        const stats = await apiClient.getPipelineStats();
        if (!isMounted) return;

        setPipelineStats({
          waiting: stats.waiting || 0,
          active: stats.active || 0,
          completed: stats.completed || 0,
          failed: stats.failed || 0,
        });
      } catch (error) {
        console.error('Failed to fetch pipeline stats:', error);
      }
    }

    if (user) {
      void fetchStats();
      const timer = window.setInterval(() => {
        void fetchStats();
      }, 10000);

      return () => {
        isMounted = false;
        window.clearInterval(timer);
      };
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (jobFilter === 'failed' && pipelineStats.failed === 0) {
      setJobFilter('all');
    }
  }, [jobFilter, pipelineStats.failed]);

  useEffect(() => {
    jobs.forEach((job) => {
      const hasRealJobId = !job.id.startsWith('temp_');
      const isTerminal = job.status === 'completed' || job.status === 'failed';

      if (!hasRealJobId) {
        return;
      }

      if (isTerminal) {
        stopPollingJob(job.id);
      } else {
        startPollingJob(job.id);
      }
    });
  }, [jobs, startPollingJob, stopPollingJob]);

  useEffect(() => {
    if (!isDetailDrawerOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDetailDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isDetailDrawerOpen]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="mb-8 space-y-3">
              <div className="h-9 w-56 rounded-lg skeleton-shimmer"></div>
              <div className="h-4 w-11/12 rounded skeleton-shimmer"></div>
            </div>

            <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-4">
                <div className="h-4 w-24 rounded skeleton-shimmer"></div>
                <div className="h-4 w-24 rounded skeleton-shimmer"></div>
                <div className="h-4 w-24 rounded skeleton-shimmer"></div>
                <div className="h-4 w-24 rounded skeleton-shimmer"></div>
              </div>
            </div>

            <div className="mt-8">
              <div className="h-7 w-40 rounded mb-4 skeleton-shimmer"></div>
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        <div className="h-5 w-5 rounded-full skeleton-shimmer"></div>
                        <div className="space-y-2">
                          <div className="h-4 w-52 rounded skeleton-shimmer"></div>
                          <div className="h-4 w-20 rounded-full skeleton-shimmer"></div>
                        </div>
                      </div>
                      <div className="h-4 w-10 rounded skeleton-shimmer"></div>
                    </div>
                    <div className="h-2 w-full rounded-full skeleton-shimmer"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const showZoneError = useCallback((message: string) => {
    setZoneError(message);
    if (zoneErrorTimeoutRef.current) {
      window.clearTimeout(zoneErrorTimeoutRef.current);
    }
    zoneErrorTimeoutRef.current = window.setTimeout(() => {
      setZoneError(null);
      zoneErrorTimeoutRef.current = null;
    }, 3000);
  }, []);

  const isValidUploadFile = useCallback((file: File) => {
    const lowerName = file.name.toLowerCase();
    return lowerName.endsWith('.pdf') || lowerName.endsWith('.docx');
  }, []);

  const processUploadQueue = useCallback(async () => {
    if (isQueueRunningRef.current) {
      return;
    }

    isQueueRunningRef.current = true;

    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) continue;

      setIsUploading(true);

      if (uploadMode === 'background') {
        setJobs((prev) =>
          prev.map((job) =>
            job.id === next.tempJobId ? { ...job, status: 'uploading', progress: 0 } : job
          )
        );
      }

      try {
        const response =
          uploadMode === 'sync'
            ? await apiClient.uploadFile(next.file)
            : await apiClient.uploadFileAsync(next.file);

        if (uploadMode === 'sync') {
          const syncResponse = response as any;
          setJobs((prev) => [
            ...prev,
            {
              id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              fileName: syncResponse?.file?.id || next.file.name,
              fileId: syncResponse?.file?.id,
              status: 'completed',
              progress: 100,
              chunks: syncResponse?.chunks,
            },
          ]);
        } else {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === next.tempJobId
                ? { ...job, id: response.jobId, status: 'pending', progress: 0 }
                : job
            )
          );
        }

        if (uploadMode === 'background') {
          startPollingJob(response.jobId);
        }
      } catch (error) {
        console.error('Upload error:', error);

        if (uploadMode === 'sync') {
          setJobs((prev) => [
            ...prev,
            {
              id: next.tempJobId,
              fileName: next.file.name,
              status: 'failed',
              progress: 0,
              error: error instanceof Error ? error.message : 'Upload failed',
            },
          ]);
        } else {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === next.tempJobId
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
    }

    setIsUploading(false);
    isQueueRunningRef.current = false;
  }, [startPollingJob, uploadMode]);

  const enqueueFiles = useCallback(
    async (files: File[]) => {
      const validFiles = files.filter(isValidUploadFile);
      const invalidCount = files.length - validFiles.length;

      if (invalidCount > 0) {
        showZoneError('Only PDF and DOCX files are accepted.');
      }

      if (validFiles.length === 0) {
        return;
      }

      validFiles.forEach((file) => {
        const tempJobId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        if (uploadMode === 'background') {
          const pendingJob: UploadJob = {
            id: tempJobId,
            fileName: file.name,
            status: 'pending',
            progress: 0,
          };
          setJobs((prev) => [...prev, pendingJob]);
        }

        queueRef.current.push({ tempJobId, file });
      });

      await processUploadQueue();
    },
    [isValidUploadFile, processUploadQueue, showZoneError, uploadMode]
  );

  const handleUploadModeChange = (mode: UploadMode) => {
    setUploadMode(mode);
    localStorage.setItem(UPLOAD_MODE_STORAGE_KEY, mode);
  };

  const toggleChunkExpansion = (chunkId: string) => {
    setExpandedChunkIds((prev) => ({
      ...prev,
      [chunkId]: !prev[chunkId],
    }));
  };

  const openJobDetails = async (job: UploadJob) => {
    if (job.status !== 'completed') {
      return;
    }

    setExpandedChunkIds({});
    setIsDetailDrawerOpen(true);
    setSelectedJob(job);

    if (!job.id.startsWith('sync_')) {
      try {
        const details = await apiClient.getJobStatus(job.id);
        setSelectedJob((current) => {
          if (!current || current.id !== job.id) {
            return current;
          }
          return {
            ...current,
            fileName: details.fileId || current.fileName,
            fileId: details.fileId || current.fileId,
            chunks: details.chunks || current.chunks,
            chunkPreviews: details.chunkPreviews || current.chunkPreviews,
            chunkTexts: details.chunkTexts || current.chunkTexts,
            completedAt: details.completedAt || current.completedAt,
          };
        });
      } catch (error) {
        console.error('Failed to load job details:', error);
      }
    }
  };

  const useJobInChat = () => {
    if (!selectedJob) return;

    const combinedText = (selectedJob.chunkTexts || []).join('\n\n');
    if (!combinedText.trim()) {
      setZoneError('No chunk text available for this job yet.');
      return;
    }

    const truncated = combinedText.slice(0, 6000);
    const systemMessage = {
      id: `system-${Date.now()}`,
      role: 'system' as const,
      content: `Document context:\n\n${truncated}`,
      createdAt: new Date().toISOString(),
    };

    const existingRaw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    let existingMessages: Array<{ id: string; role: string; content: string; createdAt?: string }> =
      [];

    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (Array.isArray(parsed)) {
          existingMessages = parsed;
        }
      } catch {
        existingMessages = [];
      }
    }

    localStorage.setItem(
      CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify([...existingMessages, systemMessage])
    );
    router.push('/chat');
  };

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await enqueueFiles(files);
      }
    },
    [enqueueFiles]
  );

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        await enqueueFiles(files);
      }
      if (e.target) {
        e.target.value = '';
      }
    },
    [enqueueFiles]
  );

  const handleUploadZoneKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  const getStatusIcon = (status: UploadJob['status']) => {
    switch (status) {
      case 'uploading':
      case 'extracting':
      case 'chunking':
      case 'processing':
        return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'pending':
      case 'queued':
        return <Clock className="w-5 h-5 text-gray-500" />;
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
      case 'extracting':
      case 'chunking':
      case 'processing':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'pending':
      case 'queued':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'completed':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
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

          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <span>
                <span className="font-semibold">Waiting:</span> {pipelineStats.waiting}
              </span>
              <span>
                <span className="font-semibold">Active:</span> {pipelineStats.active}
              </span>
              <span>
                <span className="font-semibold">Completed:</span> {pipelineStats.completed}
              </span>
              <span>
                <span className="font-semibold">Failed:</span>{' '}
                {pipelineStats.failed > 0 ? (
                  <button
                    type="button"
                    onClick={() => setJobFilter('failed')}
                    className="text-red-600 underline font-semibold"
                  >
                    {pipelineStats.failed}
                  </button>
                ) : (
                  pipelineStats.failed
                )}
              </span>
              {jobFilter === 'failed' && (
                <button
                  type="button"
                  onClick={() => setJobFilter('all')}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-white"
                >
                  Clear failed filter
                </button>
              )}
            </div>
          </div>

          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">Upload mode</p>
            <div className="flex flex-col sm:inline-flex sm:flex-row rounded-lg border border-gray-300 p-1 bg-gray-50 gap-1 sm:gap-0">
              <button
                type="button"
                onClick={() => handleUploadModeChange('sync')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  uploadMode === 'sync'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Process now
              </button>
              <button
                type="button"
                onClick={() => handleUploadModeChange('background')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  uploadMode === 'background'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Process in background
              </button>
            </div>
          </div>

          {/* Upload Area */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload files"
            className={`border-2 border-dashed rounded-lg h-[33vh] min-h-60 p-8 text-center transition-all duration-200 flex flex-col items-center justify-center ${
              isDragOver
                ? 'border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(59,130,246,0.15)] animate-pulse'
                : zoneError
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onKeyDown={handleUploadZoneKeyDown}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <div className="text-lg font-medium text-gray-900 mb-2">
              {zoneError
                ? 'Upload error'
                : isDragOver
                  ? 'Drop files here'
                  : 'Drag and drop files here'}
            </div>
            {zoneError ? (
              <p className="text-sm text-red-600 mb-4">{zoneError}</p>
            ) : (
              <p className="text-gray-500 mb-4">Accepted file types: PDF, DOCX</p>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Browse files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            {isUploading && (
              <p className="text-sm text-blue-600 mt-4">
                {uploadMode === 'sync'
                  ? 'Processing files sequentially...'
                  : 'Uploading queue sequentially...'}
              </p>
            )}
          </div>

          {/* Jobs List */}
          {visibleJobs.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload Jobs</h2>
              <div className="space-y-4">
                {visibleJobs.map((job) => (
                  <div
                    key={job.id}
                    className={`border rounded-lg p-4 bg-gray-50 ${
                      job.status === 'completed' ? 'cursor-pointer hover:border-indigo-300' : ''
                    }`}
                    onClick={() => openJobDetails(job)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <p className="font-medium text-gray-900">{job.fileId || job.fileName}</p>
                          <div
                            className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(job.status)}`}
                          >
                            {(job.status === 'uploading' ||
                              job.status === 'extracting' ||
                              job.status === 'chunking' ||
                              job.status === 'processing') && (
                              <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse"></span>
                            )}
                            {toTitleCase(job.status)}
                          </div>
                          {job.status === 'completed' && job.chunks && (
                            <p className="text-xs text-gray-600 mt-1">
                              {job.chunks.count} chunks • {job.chunks.totalTokens} tokens
                            </p>
                          )}
                        </div>
                      </div>
                      {(job.status === 'uploading' ||
                        job.status === 'extracting' ||
                        job.status === 'chunking' ||
                        job.status === 'processing') && (
                        <div className="text-right">
                          <p className="text-sm text-gray-500">{job.progress}%</p>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {(job.status === 'uploading' ||
                      job.status === 'extracting' ||
                      job.status === 'chunking' ||
                      job.status === 'processing') && (
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(job.status)}`}
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Error Message */}
                    {job.error && <p className="text-sm text-red-600 mt-2">{job.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobs.length === 0 && (
            <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                📄
              </div>
              <p className="text-base font-semibold text-slate-900">No files uploaded yet.</p>
              <p className="mt-1 text-sm text-slate-600">Drop a file above to get started.</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Upload a File
              </button>
            </div>
          )}

          {visibleJobs.length === 0 && jobs.length > 0 && jobFilter === 'failed' && (
            <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No failed jobs match the current filter.
            </div>
          )}
        </div>
      </div>

      {isDetailDrawerOpen && selectedJob && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-lg border-l border-slate-200 bg-white p-4 shadow-2xl overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Job Details</h2>
              <button
                type="button"
                onClick={() => setIsDetailDrawerOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-500">Original file name</p>
                <p className="font-medium text-slate-900">
                  {selectedJob.fileId || selectedJob.fileName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Status</p>
                <p className="font-medium text-slate-900">{toTitleCase(selectedJob.status)}</p>
              </div>
              <div>
                <p className="text-slate-500">Completion time</p>
                <p className="font-medium text-slate-900">
                  {formatDateTime(selectedJob.completedAt)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Number of chunks</p>
                <p className="font-medium text-slate-900">{selectedJob.chunks?.count ?? 0}</p>
              </div>
              <div>
                <p className="text-slate-500">Total estimated tokens</p>
                <p className="font-medium text-slate-900">{selectedJob.chunks?.totalTokens ?? 0}</p>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Chunk preview (first 3)</h3>
              <div className="space-y-2">
                {(selectedJob.chunkPreviews || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No chunk preview available.</p>
                ) : (
                  (selectedJob.chunkPreviews || []).slice(0, 3).map((chunk) => {
                    const isExpanded = Boolean(expandedChunkIds[chunk.id]);
                    const previewText = isExpanded
                      ? chunk.text
                      : `${chunk.text.slice(0, 180)}${chunk.text.length > 180 ? '...' : ''}`;

                    return (
                      <div
                        key={chunk.id}
                        className="rounded-lg border border-slate-200 p-3 bg-slate-50"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-slate-700">
                            Chunk {chunk.index + 1}
                          </p>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleChunkExpansion(chunk.id);
                            }}
                            className="text-xs text-indigo-600 underline"
                          >
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewText}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={useJobInChat}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-white font-medium hover:bg-indigo-700"
              >
                Use in Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
