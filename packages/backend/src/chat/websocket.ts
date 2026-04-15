import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getProvider, ChatMessage, ChatOptions } from '../providers';
import { verifyToken, TokenPayload } from '../auth/jwt';

interface ChatStartPayload {
  type: 'start';
  messages: ChatMessage[];
  options?: Omit<ChatOptions, 'stream'>;
}

interface ChatAbortPayload {
  type: 'abort';
}

interface PingPayload {
  type: 'ping';
}

type ChatInboundPayload = ChatStartPayload | ChatAbortPayload | PingPayload;

const ALLOWED_ROLES = new Set(['viewer', 'member', 'admin']);

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) continue;
    const key = decodeURIComponent(rawKey.trim());
    const value = decodeURIComponent((rawValue || []).join('=').trim());
    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

function extractAccessToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const cookies = parseCookies(req.headers.cookie);
  return cookies.accessToken || null;
}

function authenticateSocketRequest(req: IncomingMessage): TokenPayload {
  const token = extractAccessToken(req);
  if (!token) {
    throw new Error('Authentication required');
  }

  const user = verifyToken(token);
  if (!user.role || !ALLOWED_ROLES.has(user.role)) {
    throw new Error('Forbidden');
  }

  return user;
}

function isChatMessage(message: unknown): message is ChatMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Record<string, unknown>;
  const role = candidate.role;
  const content = candidate.content;
  return (
    typeof role === 'string' &&
    typeof content === 'string' &&
    ['system', 'user', 'assistant', 'function'].includes(role)
  );
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function closeWithError(socket: WebSocket, message: string): void {
  send(socket, { type: 'error', message });
  socket.close(1008, message);
}

export function registerChatWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws/chat')) {
      socket.destroy();
      return;
    }

    try {
      authenticateSocketRequest(req);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket, req) => {
    let isStreaming = false;
    let isAborted = false;

    socket.on('message', (rawData) => {
      void (async () => {
        if (typeof rawData !== 'string' && !Buffer.isBuffer(rawData)) {
          closeWithError(socket, 'Unsupported payload type');
          return;
        }

        let payload: ChatInboundPayload;
        try {
          payload = JSON.parse(rawData.toString()) as ChatInboundPayload;
        } catch {
          send(socket, { type: 'error', message: 'Invalid JSON payload' });
          return;
        }

        if (payload.type === 'ping') {
          send(socket, { type: 'pong' });
          return;
        }

        if (payload.type === 'abort') {
          isAborted = true;
          return;
        }

        if (payload.type !== 'start') {
          send(socket, { type: 'error', message: 'Unsupported event type' });
          return;
        }

        if (isStreaming) {
          send(socket, { type: 'error', message: 'A stream is already active' });
          return;
        }

        const authUser = authenticateSocketRequest(req);
        const messages = payload.messages;

        if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
          send(socket, {
            type: 'error',
            message: 'messages array is required and must contain valid chat messages',
          });
          return;
        }

        isStreaming = true;
        isAborted = false;
        const streamId = randomUUID();

        const options: ChatOptions = {
          ...(payload.options || {}),
          stream: true,
        };

        send(socket, {
          type: 'start',
          id: streamId,
          streamId,
          model: options.model || 'default',
          userId: authUser.userId,
        });

        try {
          const provider = getProvider();
          let chunkIndex = 0;
          const iterator = provider.chatStream(messages, options);

          for await (const chunk of iterator) {
            if (socket.readyState !== WebSocket.OPEN || isAborted) {
              break;
            }

            const content = chunk.delta.content || '';
            if (content) {
              send(socket, {
                type: 'chunk',
                content,
                index: chunkIndex,
              });
              chunkIndex += 1;
            }

            if (chunk.finishReason) {
              send(socket, {
                type: 'done',
                finishReason: chunk.finishReason,
              });
              break;
            }
          }

          if (isAborted && socket.readyState === WebSocket.OPEN) {
            send(socket, {
              type: 'done',
              finishReason: 'abort',
            });
          }
        } catch (error) {
          send(socket, {
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown stream error',
          });
        } finally {
          isStreaming = false;
          isAborted = false;
        }
      })();
    });
  });
}
