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

import express, { Router as ExpressRouter, Request, Response } from 'express';
import { getProvider, ChatMessage, ChatOptions } from '../providers';
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

async function insertChatHistory(
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

async function getChatHistory(pool: Pool, userId: string): Promise<any[]> {
  await ensureChatHistoryTable(pool);
  const result = await pool.query(
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
    async (req: Request, res: Response) => {
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
    }
  );

  /**
   * GET /api/chat/transcribe
   *
   * Start a real-time transcription session using Server-Sent Events
   * Returns transcription results as they become available
   */
  router.get(
    '/chat/transcribe',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        // Get Deepgram provider
        const provider = getProvider();
        if (!provider.createRealtimeSession) {
          res.status(501).json({
            error: 'Transcription not supported',
            message: 'Real-time transcription is not available',
          });
          return;
        }

        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
        });

        // Disable Nagle's algorithm
        if (req.socket) {
          req.socket.setNoDelay(true);
          req.socket.setKeepAlive(true);
        }

        // Track client disconnect
        let aborted = false;
        const sessionId = randomUUID();

        req.on('close', () => {
          aborted = true;
          clearInterval(heartbeatInterval);
          // Clean up session on disconnect
          const sessions = (global as any).transcriptionSessions;
          if (sessions) {
            const session = sessions.get(sessionId);
            if (session) {
              session.close();
              sessions.delete(sessionId);
            }
          }
        });

        // Send heartbeat every 15 seconds
        const heartbeatInterval = setInterval(() => {
          if (!aborted && !res.writableEnded) {
            res.write(':heartbeat\n\n');
          }
        }, 15000);

        // Create Deepgram session
        const session = await provider.createRealtimeSession({
          model: 'nova-2',
          language: 'en-US',
          punctuate: true,
          smart_format: true,
          onTranscription: (result) => {
            if (!aborted && !res.writableEnded) {
              const eventData = JSON.stringify({
                transcript: result.transcript,
                isFinal: result.isFinal,
                confidence: result.confidence,
              });
              res.write(formatSSE('transcription', eventData));
            }
          },
          onError: (error) => {
            if (!aborted && !res.writableEnded) {
              const eventData = JSON.stringify({
                error: 'Transcription error',
                message: error.message,
              });
              res.write(formatSSE('error', eventData));
            }
          },
          onClose: () => {
            if (!aborted && !res.writableEnded) {
              res.write(formatSSE('close', JSON.stringify({})));
              res.end();
            }
            clearInterval(heartbeatInterval);
            // Clean up session
            const sessions = (global as any).transcriptionSessions;
            if (sessions) sessions.delete(sessionId);
          },
        });

        // Store session for cleanup
        (global as any).transcriptionSessions = (global as any).transcriptionSessions || new Map();
        (global as any).transcriptionSessions.set(sessionId, session);

        // Send session started event
        await sendSSE(res, 'started', JSON.stringify({ sessionId }));
      } catch (error) {
        console.error('Transcription start error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Failed to start transcription session',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        } else {
          res.write(
            formatSSE(
              'error',
              JSON.stringify({
                error: 'Failed to start transcription session',
                message: error instanceof Error ? error.message : 'Unknown error',
              })
            )
          );
          res.end();
        }
      }
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const { sessionId } = req.params;
        const sessions = (global as any).transcriptionSessions || new Map();
        const session = sessions.get(sessionId);

        if (!session) {
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
        session.send(audioData);

        res.json({ success: true });
      } catch (error) {
        console.error('Transcription send error:', error);
        res.status(500).json({
          error: 'Failed to send audio data',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const { sessionId } = req.params;
        const sessions = (global as any).transcriptionSessions || new Map();
        const session = sessions.get(sessionId);

        if (session) {
          session.close();
          sessions.delete(sessionId);
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Session close error:', error);
        res
          .status(500)
          .json({ error: 'Close failed', message: 'Failed to close transcription session' });
      }
    }
  );

  /**
   * GET /api/chat/history
   *
   * Get chat history for the authenticated user
   */
  router.get(
    '/history',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.user) {
          res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
          return;
        }

        const history = await getChatHistory(pool, req.user.userId);

        // Transform the data to match frontend expectations
        const formattedHistory = history.map((item) => ({
          id: item.id,
          userId: item.user_id,
          userEmail: item.user_email,
          role: item.role,
          streamId: item.stream_id,
          messages: item.messages,
          createdAt: item.created_at,
        }));

        res.json(formattedHistory);
      } catch (error) {
        console.error('Failed to fetch chat history:', error);
        res.status(500).json({
          error: 'Failed to fetch chat history',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/chat/history
   *
   * Save chat history for the authenticated user
   */
  router.post(
    '/history',
    authenticate as any,
    requireViewer as any,
    async (req: AuthenticatedRequest, res: Response) => {
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
        res.status(500).json({
          error: 'Failed to save chat history',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
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

      await insertChatHistory(
        pool,
        user.userId,
        user.email,
        user.role || 'user',
        streamId,
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

export { createChatRoutes as chatRoutes };
