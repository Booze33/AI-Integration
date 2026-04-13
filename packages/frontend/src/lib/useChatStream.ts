import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api/client';

type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatStreamMessage {
  id?: string;
  role: ChatRole;
  content: string;
}

interface SSEEventPayload {
  id?: string;
  streamId?: string;
  content?: string;
  finishReason?: string;
  message?: string;
}

interface UseChatStreamOptions {
  onStart?: (payload: SSEEventPayload) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
  onDone?: (payload: SSEEventPayload) => void | Promise<void>;
  onError?: (message: string, payload?: SSEEventPayload) => void | Promise<void>;
}

const CHAT_URL = '/api/chat';
const MAX_RECONNECT_ATTEMPTS = 3;

function parseSSEChunk(chunk: string) {
  const lines = chunk.split('\n');
  let eventType = 'message';
  let data = '';
  let eventId = '';

  for (const line of lines) {
    if (line.startsWith(':')) continue;

    const [field, ...rest] = line.split(':');
    if (!field) continue;

    const value = rest.join(':').trim();
    if (field === 'event') {
      eventType = value;
    }
    if (field === 'data') {
      data += value;
    }
    if (field === 'id') {
      eventId = value;
    }
  }

  if (!data && !eventType) return null;

  let parsed: SSEEventPayload = {};
  if (data) {
    try {
      parsed = JSON.parse(data) as SSEEventPayload;
    } catch {
      parsed = { content: data };
    }
  }

  return { eventType, eventId, parsed };
}

export function useChatStream(options: UseChatStreamOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const streamIdRef = useRef<string | null>(null);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const start = useCallback(
    async (messages: ChatStreamMessage[]) => {
      abort();
      lastEventIdRef.current = null;
      streamIdRef.current = null;
      setStreamId(null);

      setError(null);
      setIsStreaming(true);

      let reconnectAttempts = 0;
      let completed = false;

      while (!completed) {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
          const body: Record<string, unknown> = { messages };
          if (streamIdRef.current) {
            body.streamId = streamIdRef.current;
          }

          const response = await apiFetch(CHAT_URL, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(lastEventIdRef.current ? { 'Last-Event-ID': lastEventIdRef.current } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            const text = await response.text();
            throw new Error(text || `Request failed with ${response.status}`);
          }

          reconnectAttempts = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let receivedDoneEvent = false;

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            let separatorIndex = -1;
            while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
              const rawEvent = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2);

              const parsedEvent = parseSSEChunk(rawEvent);
              if (!parsedEvent) continue;

              const { eventType, eventId, parsed } = parsedEvent;

              if (eventId) {
                lastEventIdRef.current = eventId;
              }

              if (eventType === 'start') {
                const nextStreamId = parsed.streamId || parsed.id;
                if (nextStreamId) {
                  streamIdRef.current = nextStreamId;
                  setStreamId(nextStreamId);
                }
                if (options.onStart) {
                  await options.onStart(parsed);
                }
                continue;
              }

              if (eventType === 'chunk' && parsed.content) {
                if (options.onChunk) {
                  await options.onChunk(parsed.content);
                }
                continue;
              }

              if (eventType === 'done') {
                receivedDoneEvent = true;
                completed = true;
                if (options.onDone) {
                  await options.onDone(parsed);
                }
                break;
              }

              if (eventType === 'error') {
                const errorMessage = parsed.message || 'Stream error';
                setError(errorMessage);
                completed = true;
                if (options.onError) {
                  await options.onError(errorMessage, parsed);
                }
                break;
              }
            }

            if (receivedDoneEvent || completed) {
              break;
            }
          }

          if (completed) {
            break;
          }

          if (controller.signal.aborted) {
            completed = true;
            break;
          }

          if (lastEventIdRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts += 1;
            continue;
          }

          const disconnectMessage = 'Stream disconnected before completion';
          setError(disconnectMessage);
          if (options.onError) {
            await options.onError(disconnectMessage);
          }
          completed = true;
        } catch (streamError) {
          if (controller.signal.aborted) {
            break;
          }

          if (lastEventIdRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts += 1;
            continue;
          }

          const message =
            streamError instanceof Error ? streamError.message : 'Unknown stream error';
          setError(message);
          if (options.onError) {
            await options.onError(message);
          }
          completed = true;
        }
      }

      abortControllerRef.current = null;
      setIsStreaming(false);
    },
    [abort, options]
  );

  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return {
    start,
    abort,
    isStreaming,
    error,
    streamId,
  };
}
