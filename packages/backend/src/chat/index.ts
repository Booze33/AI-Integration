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

import { Router as ExpressRouter, Request, Response } from 'express';
import { getProvider, ChatMessage, ChatOptions } from '../providers';
import { randomUUID } from 'crypto';

const router: ExpressRouter = ExpressRouter();

/**
 * In-memory store for resumable streams
 * In production, use Redis or a similar store for distributed systems
 */
interface StreamState {
  id: string;
  messages: ChatMessage[];
  options?: ChatOptions;
  chunks: string[];
  finished: boolean;
  error?: string;
  createdAt: number;
}

const streamStore = new Map<string, StreamState>();

// Cleanup old streams every 5 minutes
setInterval(
  () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [id, state] of streamStore.entries()) {
      if (state.createdAt < fiveMinutesAgo) {
        streamStore.delete(id);
      }
    }
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
 * POST /api/chat
 *
 * Streams AI response via Server-Sent Events
 *
 * Request body:
 * - messages: ChatMessage[] (required)
 * - model?: string
 * - temperature?: number
 * - maxTokens?: number
 * - topP?: number
 * - frequencyPenalty?: number
 * - presencePenalty?: number
 * - stop?: string[]
 * - streamId?: string (for reconnect support)
 *
 * Headers:
 * - Last-Event-ID: string (for reconnect support)
 *
 * SSE Events:
 * - start: { id: string, model: string }
 * - chunk: { content: string }
 * - done: { finishReason: string, usage?: object }
 * - error: { message: string, code?: string }
 */
router.post('/chat', async (req: Request, res: Response) => {
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
    const existingStream = streamStore.get(reconnectStreamId);
    if (existingStream) {
      // Resume existing stream
      await resumeStream(req, res, existingStream);
      return;
    }
    // If stream not found, start a new one (client will get full response)
  }

  // Start new stream
  await startNewStream(req, res, body);
});

/**
 * Start a new streaming response
 */
async function startNewStream(req: Request, res: Response, body: ChatRequestBody): Promise<void> {
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

  // Store stream state for reconnect support
  const streamState: StreamState = {
    id: streamId,
    messages: body.messages,
    options,
    chunks: [],
    finished: false,
    createdAt: Date.now(),
  };
  streamStore.set(streamId, streamState);

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
      // Store chunk for reconnect support
      const content = chunk.delta.content || '';
      if (content) {
        streamState.chunks.push(content);
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
        streamState.finished = true;
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

    // Clean up
    clearInterval(heartbeatInterval);
    streamStore.delete(streamId);
  } catch (error) {
    clearInterval(heartbeatInterval);

    // Store error state
    streamState.finished = true;
    streamState.error = error instanceof Error ? error.message : 'Unknown error';

    // Send error event
    if (!res.writableEnded) {
      await sendSSE(
        res,
        'error',
        JSON.stringify({
          message: streamState.error,
          code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        }),
        `${streamId}-error`
      );
    }

    // Clean up
    streamStore.delete(streamId);
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

/**
 * GET /api/chat/health
 *
 * Health check endpoint for the chat service
 */
router.get('/chat/health', (_, res) => {
  res.json({
    status: 'ok',
    service: 'chat',
    activeStreams: streamStore.size,
    timestamp: new Date().toISOString(),
  });
});

export { router as chatRoutes };
