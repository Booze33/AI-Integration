/**
 * Streaming Chat Endpoint
 *
 * POST /api/chat — streams AI response via SSE
 * Features:
 * - Server-Sent Events (SSE) streaming
 * - Abort handling (client disconnect)
 * - Reconnect support (Last-Event-ID)
 * - Partial writes with backpressure
 * - Error handling and recovery
 */

import express, { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { getProvider, ChatMessage, ChatOptions } from '../providers';
import type { AIProvider } from '../providers';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { authenticate, requireViewer, AuthenticatedRequest } from '../auth/middleware';
import {
  storeStreamState,
  getStreamState,
  deleteStreamState,
  addStreamChunk,
  markStreamFinished,
  StreamState,
  cleanupOldStreams,
} from '../redis/stream-store';

async function ensureChatHistoryTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.chat_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      stream_id UUID NULL,
      messages JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const isValidUUID = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export { isValidUUID };

export async function insertChatHistory(
  pool: Pool,
  userId: string,
  userEmail: string,
  role: string,
  streamId: string | null,
  messages: ChatMessage[]
): Promise<void> {
  await ensureChatHistoryTable(pool);
  await pool.query(
    `INSERT INTO app.chat_history (user_id, user_email, role, stream_id, messages) VALUES ($1, $2, $3, $4, $5)`,
    [userId, userEmail, role, streamId, JSON.stringify(messages)]
  );
}

async function getChatHistory(pool: Pool, userId: string): Promise<ChatHistoryRow[]> {
  await ensureChatHistoryTable(pool);
  const result = await pool.query<ChatHistoryRow>(
    `SELECT id, user_id, user_email, role, stream_id, messages, created_at FROM app.chat_history WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Redis-based store for resumable streams
 * Using Redis enables multi-instance support and automatic TTL-based cleanup
 *
 * Note: The StreamState interface is imported from '../redis/stream-store'
 */

// Cleanup old streams (Redis TTL handles this automatically)
// Keep the interval for compatibility, but it just logs that Redis handles cleanup
setInterval(
  () => {
    cleanupOldStreams().catch((error) => {
      console.error('Error during stream cleanup:', error);
    });
  },
  5 * 60 * 1000
);

/**
 * SSE event formatter
 */
function formatSSE(event: string, data: string, id?: string): string {
  let message = '';
  if (id) {
    message += `id: ${id}\n`;
  }
  message += `event: ${event}\n`;
  message += `data: ${data}\n\n`;
  return message;
}

/**
 * Send SSE event with backpressure handling
 */
async function sendSSE(res: Response, event: string, data: string, id?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const message = formatSSE(event, data, id);
    const canWrite = res.write(message);

    if (canWrite) {
      resolve(true);
    } else {
      // Handle backpressure - wait for drain event
      res.once('drain', () => resolve(true));
    }
  });
}

/**
 * Request body interface
 */
interface ChatRequestBody {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  streamId?: string; // For reconnect support
  sessionId?: string; // Stable chat session ID for cross-turn history grouping
}

type RealtimeSession = Awaited<ReturnType<NonNullable<AIProvider['createRealtimeSession']>>>;

interface ChatHistoryRow {
  id: string;
  user_id: string;
  user_email: string;
  role: string;
  stream_id: string | null;
  messages: ChatMessage[];
  created_at: string;
}

interface ChatHistorySession {
  sessionId: string;
  streamId: string | null;
  userId: string;
  userEmail: string;
  role: string;
  title: string;
  messages: ChatMessage[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BufferedTranscriptionEvent {
  event: string;
  data: string;
  id?: string;
}

interface TranscriptionSessionContext {
  sessionId: string;
  ownerUserId: string;
  session: RealtimeSession;
  clients: Set<Response>;
  bufferedEvents: BufferedTranscriptionEvent[];
  closed: boolean;
}

const transcriptionSessions = new Map<string, TranscriptionSessionContext>();

function buildChatHistoryTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content?.trim();
  if (!firstUserMessage) {
    return 'Untitled conversation';
  }

  return firstUserMessage.length > 80
    ? `${firstUserMessage.slice(0, 77).trimEnd()}...`
    : firstUserMessage;
}

function groupChatHistorySessions(rows: ChatHistoryRow[]): ChatHistorySession[] {
  const sessions = new Map<string, ChatHistorySession>();

  for (const row of rows) {
    const sessionId = row.stream_id || row.id;
    const existing = sessions.get(sessionId);

    if (!existing) {
      sessions.set(sessionId, {
        sessionId,
        streamId: row.stream_id,
        userId: row.user_id,
        userEmail: row.user_email,
        role: row.role,
        title: buildChatHistoryTitle(row.messages),
        messages: row.messages,
        messageCount: row.messages.length,
        createdAt: row.created_at,
        updatedAt: row.created_at,
      });
      continue;
    }

    const isNewer = new Date(row.created_at).getTime() >= new Date(existing.updatedAt).getTime();
    if (isNewer) {
      existing.messages = row.messages;
      existing.messageCount = row.messages.length;
      existing.updatedAt = row.created_at;
      existing.title = buildChatHistoryTitle(row.messages);
    }

    if (new Date(row.created_at).getTime() < new Date(existing.createdAt).getTime()) {
      existing.createdAt = row.created_at;
    }
  }

  return [...sessions.values()].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function bufferTranscriptionEvent(
  context: TranscriptionSessionContext,
  event: string,
  data: string,
  id?: string
): void {
  const payload = { event, data, id };
  context.bufferedEvents.push(payload);

  if (context.bufferedEvents.length > 100) {
    context.bufferedEvents.shift();
  }

  for (const client of context.clients) {
    if (!client.writableEnded) {
      client.write(formatSSE(event, data, id));
    }
  }
}

function closeTranscriptionSession(sessionId: string): void {
  const context = transcriptionSessions.get(sessionId);
  if (!context || context.closed) {
    return;
  }

  context.closed = true;
  context.session.close();
  transcriptionSessions.delete(sessionId);
}

/**
 * Create chat routes with database pool
 */
export function createChatRoutes(pool: Pool): ExpressRouter {
  // Ensure chat history table exists on startup
  ensureChatHistoryTable(pool).catch((error) => {
    console.error('Failed to create chat history table:', error);
  });

  const router: ExpressRouter = ExpressRouter();

  router.post(
    '/chat',
    authenticate as any,
    requireViewer as any,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authReq = req as AuthenticatedRequest;

        // If this route is called without valid session, auth middleware handles response.
        if (!authReq.user) {
          return;
        }

        // Validate request body
        const body = req.body as ChatRequestBody;

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          res.status(400).json({
            error: 'Invalid request',
            message: 'messages array is required and must not be empty',
          });
          return;
        }

        // Validate message format
        for (const msg of body.messages) {
          if (!msg.role || !msg.content) {
            res.status(400).json({
              error: 'Invalid message format',
              message: 'Each message must have role and content',
            });
            return;
          }
          if (!['system', 'user', 'assistant', 'function'].includes(msg.role)) {
            res.status(400).json({
              error: 'Invalid message role',
              message: 'Role must be one of: system, user, assistant, function',
            });
            return;
          }
        }

        // Check for reconnect (via Last-Event-ID header or streamId in body)
        const lastEventId = req.headers['last-event-id'] as string | undefined;
        const reconnectStreamId = lastEventId || body.streamId;

        if (reconnectStreamId) {
          const existingStream = await getStreamState(reconnectStreamId);
          if (existingStream) {
            // Resume existing stream
            await resumeStream(req, res, existingStream);
            return;
          }
          // If stream not found, start a new one (client will get full response)
        }

        // Start new stream
        await startNewStream(authReq, res, body, authReq.user, pool);
      } catch (error) {
        console.error('Chat route error:', error);
        next(error);
      }
    }
  );

  router.post(
    '/chat/transcribe/session',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const provider = getProvider();
        if (!provider.createRealtimeSession) {
          res.status(501).json({
            error: 'Transcription not supported',
            message: 'Real-time transcription is not available',
          });
          return;
        }

        const sessionId = randomUUID();
        const context: TranscriptionSessionContext = {
          sessionId,
          ownerUserId: req.user.userId,
          session: undefined as unknown as RealtimeSession,
          clients: new Set<Response>(),
          bufferedEvents: [],
          closed: false,
        };

        context.session = await provider.createRealtimeSession({
          model: 'nova-2',
          language: 'en-US',
          punctuate: true,
          smart_format: true,
          onTranscription: (result) => {
            bufferTranscriptionEvent(
              context,
              'transcription',
              JSON.stringify({
                transcript: result.transcript,
                isFinal: result.isFinal,
                confidence: result.confidence,
              })
            );
          },
          onError: (error) => {
            bufferTranscriptionEvent(
              context,
              'transcription-error',
              JSON.stringify({
                error: 'Transcription error',
                message: error.message,
              })
            );
          },
          onClose: () => {
            bufferTranscriptionEvent(context, 'close', JSON.stringify({ sessionId }));
            for (const client of context.clients) {
              if (!client.writableEnded) {
                client.end();
              }
            }
            transcriptionSessions.delete(sessionId);
          },
        });

        transcriptionSessions.set(sessionId, context);
        bufferTranscriptionEvent(context, 'ready', JSON.stringify({ sessionId }));

        res.status(201).json({ sessionId });
      } catch (error) {
        console.error('Transcription session create error:', error);
        next(error);
      }
    }
  );

  router.get(
    '/chat/transcribe/:sessionId',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
        return;
      }

      const { sessionId } = req.params;
      const context = transcriptionSessions.get(sessionId);

      if (!context || context.ownerUserId !== req.user.userId) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      if (req.socket) {
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
      }

      context.clients.add(res);

      for (const event of context.bufferedEvents) {
        if (res.writableEnded) {
          break;
        }
        res.write(formatSSE(event.event, event.data, event.id));
      }

      const heartbeatInterval = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':heartbeat\n\n');
        }
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeatInterval);
        context.clients.delete(res);
      });
    }
  );

  /**
   * POST /api/chat/transcribe/:sessionId
   *
   * Send audio data to an active transcription session
   */
  router.post(
    '/chat/transcribe/:sessionId',
    authenticate as any,
    requireViewer as any,
    express.raw({ type: '*/*' }),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const { sessionId } = req.params;
        const context = transcriptionSessions.get(sessionId);

        if (!context || context.ownerUserId !== req.user.userId) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        // Get raw audio data from request body
        const audioData = req.body;
        if (!audioData || !Buffer.isBuffer(audioData)) {
          res.status(400).json({ error: 'Invalid audio data' });
          return;
        }

        // Send audio data to Deepgram
        context.session.send(audioData);

        res.json({ success: true });
      } catch (error) {
        console.error('Transcription send error:', error);
        next(error);
      }
    }
  );

  /**
   * DELETE /api/chat/transcribe/:sessionId
   *
   * Close a transcription session
   */
  router.delete(
    '/chat/transcribe/:sessionId',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const { sessionId } = req.params;
        const context = transcriptionSessions.get(sessionId);

        if (context && context.ownerUserId === req.user.userId) {
          closeTranscriptionSession(sessionId);
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Session close error:', error);
        next(error);
      }
    }
  );

  /**
   * GET /api/chat/history
   *
   * Get chat history for the authenticated user
   */
  router.get(
    '/chat/history',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const history = await getChatHistory(pool, req.user.userId);

        // Transform the data to match frontend expectations
        res.json({
          sessions: groupChatHistorySessions(history),
        });
      } catch (error) {
        console.error('Failed to fetch chat history:', error);
        next(error);
      }
    }
  );

  /**
   * POST /api/chat/history
   *
   * Save chat history for the authenticated user
   */
  router.post(
    '/chat/history',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const { messages, streamId } = req.body;

        if (!messages || !Array.isArray(messages)) {
          res.status(400).json({
            error: 'Invalid request',
            message: 'messages array is required',
          });
          return;
        }

        // Validate message format
        for (const msg of messages) {
          if (!msg.role || !msg.content) {
            res.status(400).json({
              error: 'Invalid message format',
              message: 'Each message must have role and content',
            });
            return;
          }
          if (!['system', 'user', 'assistant', 'function'].includes(msg.role)) {
            res.status(400).json({
              error: 'Invalid message role',
              message: 'Role must be one of: system, user, assistant, function',
            });
            return;
          }
        }

        // Extract user role from messages (look for system messages or use default)
        const userRole = messages.find((msg) => msg.role === 'system')?.content || 'user';

        await insertChatHistory(
          pool,
          req.user.userId,
          req.user.email,
          userRole,
          streamId || null,
          messages
        );

        res.json({ success: true });
      } catch (error) {
        console.error('Failed to save chat history:', error);
        next(error);
      }
    }
  );

  return router;
}

/**
 * Start a new streaming response
 */
async function startNewStream(
  req: AuthenticatedRequest,
  res: Response,
  body: ChatRequestBody,
  user: { userId: string; email: string; role?: string } | undefined,
  pool: Pool
): Promise<void> {
  const streamId = randomUUID();

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
  });

  // Disable Nagle's algorithm for lower latency
  if (req.socket) {
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
  }

  // Create chat options
  const options: ChatOptions = {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    topP: body.topP,
    frequencyPenalty: body.frequencyPenalty,
    presencePenalty: body.presencePenalty,
    stop: body.stop,
    stream: true,
  };

  // Store stream state for reconnect support in Redis
  const streamState: StreamState = {
    id: streamId,
    messages: body.messages,
    options,
    chunks: [],
    finished: false,
    createdAt: Date.now(),
  };
  await storeStreamState(streamState);

  let assistantText = '';

  // Track client disconnect
  let aborted = false;
  req.on('close', () => {
    aborted = true;
    // Keep stream state for potential reconnect
    // Will be cleaned up by the interval
  });

  // Send heartbeat every 15 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(':heartbeat\n\n');
    }
  }, 15000);

  try {
    // Get AI provider
    const provider = getProvider();

    // Send start event
    await sendSSE(
      res,
      'start',
      JSON.stringify({
        id: streamId,
        streamId,
        model: options.model || 'default',
      }),
      streamId
    );

    // Stream chunks from provider
    let chunkIndex = 0;
    const streamIterator = provider.chatStream(body.messages, options);

    for await (const chunk of streamIterator) {
      // Store chunk for reconnect support in Redis
      const content = chunk.delta.content || '';
      if (content) {
        assistantText += content;
        await addStreamChunk(streamId, content);
      }

      // Send chunk event
      await sendSSE(
        res,
        'chunk',
        JSON.stringify({
          content,
          index: chunkIndex,
        }),
        `${streamId}-${chunkIndex}`
      );

      chunkIndex++;

      // Send done event if finished
      if (chunk.finishReason) {
        await markStreamFinished(streamId);
        await sendSSE(
          res,
          'done',
          JSON.stringify({
            finishReason: chunk.finishReason,
          }),
          `${streamId}-done`
        );
      }
    }

    // Persist final conversation to history DB if user info exists
    if (user) {
      const conversation: ChatMessage[] = [
        ...body.messages,
        { role: 'assistant', content: assistantText },
      ];

      // Use client-provided sessionId as the stable grouping key so all turns
      // in one conversation share the same stream_id in chat_history.
      const historyStreamId = isValidUUID(body.sessionId) ? body.sessionId : streamId;
      await insertChatHistory(
        pool,
        user.userId,
        user.email,
        user.role || 'user',
        historyStreamId,
        conversation
      );
    }

    // Clean up
    clearInterval(heartbeatInterval);
    await deleteStreamState(streamId);
  } catch (error) {
    clearInterval(heartbeatInterval);

    // Store error state in Redis
    await markStreamFinished(streamId, error instanceof Error ? error.message : 'Unknown error');

    // Send error event
    if (!res.writableEnded) {
      await sendSSE(
        res,
        'error',
        JSON.stringify({
          message: error instanceof Error ? error.message : 'Unknown error',
          code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        }),
        `${streamId}-error`
      );
    }

    // Clean up (stream is already marked as finished in Redis, keep for potential reconnect)
    // Redis TTL will automatically clean it up
  } finally {
    // End response if not already ended
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Resume an existing stream (reconnect support)
 */
async function resumeStream(req: Request, res: Response, streamState: StreamState): Promise<void> {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
  });

  if (req.socket) {
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
  }

  // Track client disconnect
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  // Send heartbeat
  const heartbeatInterval = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(':heartbeat\n\n');
    }
  }, 15000);

  try {
    // Send start event
    await sendSSE(
      res,
      'start',
      JSON.stringify({
        id: streamState.id,
        streamId: streamState.id,
        model: streamState.options?.model || 'default',
        resumed: true,
      }),
      streamState.id
    );

    // Replay stored chunks
    for (let i = 0; i < streamState.chunks.length; i++) {
      if (aborted) {
        clearInterval(heartbeatInterval);
        return;
      }

      await sendSSE(
        res,
        'chunk',
        JSON.stringify({
          content: streamState.chunks[i],
          index: i,
        }),
        `${streamState.id}-${i}`
      );
    }

    // If stream is finished, send done event
    if (streamState.finished) {
      if (streamState.error) {
        await sendSSE(
          res,
          'error',
          JSON.stringify({
            message: streamState.error,
          }),
          `${streamState.id}-error`
        );
      } else {
        await sendSSE(
          res,
          'done',
          JSON.stringify({
            finishReason: 'stop',
          }),
          `${streamState.id}-done`
        );
      }
    } else {
      // Stream is still in progress, continue from where we left off
      // This would require resuming the actual stream from the provider
      // For now, we'll just send what we have and mark as done
      await sendSSE(
        res,
        'done',
        JSON.stringify({
          finishReason: 'stop',
          note: 'Stream resumed from cache',
        }),
        `${streamState.id}-done`
      );
    }

    clearInterval(heartbeatInterval);
  } catch (error) {
    clearInterval(heartbeatInterval);

    if (!res.writableEnded) {
      await sendSSE(
        res,
        'error',
        JSON.stringify({
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        `${streamState.id}-error`
      );
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

const fallbackTestPool = {
  query: async () => ({ rows: [] }),
} as unknown as Pool;

// Backward-compatible router export used by older tests and call sites.
export const chatRoutes = createChatRoutes(fallbackTestPool);
