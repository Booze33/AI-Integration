'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import VoiceInput from '../../components/VoiceInput';
import { apiClient } from '../../lib/api-client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface SSEEventPayload {
  id?: string;
  content?: string;
  index?: number;
  finishReason?: string;
  message?: string;
}

interface UserInfo {
  id: string;
  email: string;
  role: string;
}

const CHAT_URL = '/api/chat';

const STORAGE_KEYS = {
  history: 'chatHistory',
  streamId: 'chatStreamId',
  lastEventId: 'chatLastEventId',
};

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [finishedReason, setFinishedReason] = useState('');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);

  const userMessageText = useMemo(
    () => (voiceTranscript || input).trim(),
    [input, voiceTranscript]
  );

  useEffect(() => {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.history);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory) as ChatMessage[];
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      } catch {
        setMessages([{ id: 's1', role: 'system', content: 'You are a helpful assistant.' }]);
      }
    } else {
      setMessages([{ id: 's1', role: 'system', content: 'You are a helpful assistant.' }]);
    }

    const savedStreamId = localStorage.getItem(STORAGE_KEYS.streamId);
    const savedLastEventId = localStorage.getItem(STORAGE_KEYS.lastEventId);
    if (savedStreamId) {
      setStreamId(savedStreamId);
      setLastEventId(savedLastEventId);
      if (!isStreaming) {
        setIsReconnecting(true);
      }
    }

    async function verifyAuth() {
      try {
        const response = await apiClient.getCurrentUser();
        setUser(response.user);
      } catch {
        router.push('/login');
      }
    }

    verifyAuth();
  }, [isStreaming, router]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (streamId) {
      localStorage.setItem(STORAGE_KEYS.streamId, streamId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.streamId);
      localStorage.removeItem(STORAGE_KEYS.lastEventId);
    }
  }, [streamId]);

  useEffect(() => {
    if (lastEventId) {
      localStorage.setItem(STORAGE_KEYS.lastEventId, lastEventId);
    }
  }, [lastEventId]);

  useEffect(() => {
    if (isReconnecting && streamId) {
      resumeStream();
    }
  }, [isReconnecting, streamId]);

  const saveChatHistory = async (historyMessages: ChatMessage[], streamId?: string) => {
    try {
      // Use the apiClient's saveChatHistory method
      await apiClient.saveChatHistory(historyMessages, streamId);
    } catch (err) {
      console.error('Failed to persist chat history:', err);
    }
  };

  const appendMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  };

  const _updateAssistant = (content: string, partial = false) => {
    setMessages((prev) => {
      const assistant = prev.find((m) => m.role === 'assistant' && m.id === 'assistant-draft');
      if (assistant) {
        const updated = { ...assistant, content };
        return prev.map((msg) => (msg.id === 'assistant-draft' ? updated : msg));
      }
      if (partial || content) {
        return [...prev, { id: 'assistant-draft', role: 'assistant', content }];
      }
      return prev;
    });
  };

  const finalizeAssistant = () => {
    setMessages((prev) =>
      prev.map((m) => (m.id === 'assistant-draft' ? { ...m, id: `assistant-${Date.now()}` } : m))
    );
  };

  const parseSSE = (chunk: string) => {
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

    return { eventType, parsed, eventId };
  };

  const streamRequest = async ({
    messagesPayload,
  }: {
    messagesPayload: ChatMessage[];
    reconnect?: boolean;
  }) => {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setError(null);
    setFinishedReason('');
    setIsStreaming(true);
    setInputDisabled(true);

    try {
      const body: Record<string, unknown> = { messages: messagesPayload };
      if (streamId) body.streamId = streamId;

      const response = await fetch(CHAT_URL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantDraft = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);

          const result = parseSSE(raw);
          if (!result) continue;

          const { eventType, parsed, eventId } = result;
          if (eventId) {
            setLastEventId(eventId);
          }

          if (eventType === 'start') {
            if (parsed?.id) {
              setStreamId(parsed.id);
            }
            setIsReconnecting(false);
          }

          if (eventType === 'chunk' && parsed?.content) {
            assistantDraft += parsed.content;
            _updateAssistant(assistantDraft, true);

            const incomingText = parsed.content.trim();
            const tokens = incomingText ? incomingText.split(/\s+/).filter(Boolean).length : 0;
            setTokenCount((prev) => prev + tokens);
            setCharCount((prev) => prev + (parsed.content ? parsed.content.length : 0));
          }

          if (eventType === 'done') {
            setFinishedReason(parsed?.finishReason || 'stop');
            const persistedMessages = [
              ...messages.filter((m) => m.id !== 'assistant-draft'),
              { role: 'assistant' as const, content: assistantDraft },
            ] as ChatMessage[];
            saveChatHistory(persistedMessages, streamId || undefined);
            finalizeAssistant();
            setIsStreaming(false);
            setIsReconnecting(false);
            setStreamId(null);
            localStorage.removeItem(STORAGE_KEYS.streamId);
            localStorage.removeItem(STORAGE_KEYS.lastEventId);
          }

          if (eventType === 'error') {
            setError(parsed?.message || 'Stream error');
            finalizeAssistant();
            setIsStreaming(false);
            setIsReconnecting(false);
          }
        }
      }

      if (buffer.trim().length > 0) {
        const result = parseSSE(buffer);
        if (result?.eventType === 'chunk' && result.parsed.content) {
          assistantDraft += result.parsed.content;
          _updateAssistant(assistantDraft, true);
        }
      }

      if (!isStreaming) {
        finalizeAssistant();
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Streaming cancelled by user');
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error during streaming');
      }
      setIsStreaming(false);
      setIsReconnecting(false);
      finalizeAssistant();
    } finally {
      setInputDisabled(false);
      streamAbortRef.current = null;
    }
  };

  const startChat = async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed) return;

    setTokenCount(0);
    setCharCount(0);

    const newUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    appendMessage(newUserMessage);
    _updateAssistant('');

    const payload = [
      ...messages.filter((m) => m.role !== 'assistant' || m.id !== 'assistant-draft'),
      newUserMessage,
    ];
    await streamRequest({ messagesPayload: payload });
  };

  const resumeStream = async () => {
    if (!streamId) return;

    setError(null);
    setFinishedReason('');

    const payload = [
      ...messages.filter((m) => m.role !== 'assistant' || m.id !== 'assistant-draft'),
    ];

    await streamRequest({ messagesPayload: payload, reconnect: true });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    startChat(userMessageText);
    setInput('');
    setVoiceTranscript('');
  };

  const handleCancel = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
  };

  const handleVoiceTranscription = (text: string, isFinal: boolean) => {
    setVoiceTranscript(text);
    if (isFinal) {
      setInput(text);
      setVoiceTranscript('');
      setIsVoiceInputActive(false);
    }
  };

  const handleVoiceStateChange = (isActive: boolean) => {
    setIsVoiceInputActive(isActive);
  };

  const handleVoiceError = (error: string) => {
    setError(`Voice input error: ${error}`);
  };

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, []);

  if (user && !['admin', 'member'].includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-10">
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-6 text-center">
          <h2 className="text-xl font-semibold text-orange-700">Access denied</h2>
          <p className="text-sm text-orange-600">
            Your role ({user.role}) does not have permission to access this chat feature.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-10">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-2xl font-bold text-gray-900">Streaming AI Chat</h1>
        {user && (
          <p className="text-sm text-gray-500">
            Signed in as {user.email} ({user.role})
          </p>
        )}

        <div className="mt-6 flex min-h-[60vh] flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-100 text-blue-900 self-end'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <span className="font-semibold uppercase text-[10px] tracking-wide">
                {message.role}
              </span>
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))}

          {isStreaming && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500">
                AI is typing<span className="animate-pulse">...</span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, (tokenCount / 100) * 100)}%` }}
                />
              </div>
              <div className="text-xs text-slate-600">
                Tokens: {tokenCount}, Characters: {charCount}
              </div>
            </div>
          )}

          {!isStreaming && (tokenCount > 0 || charCount > 0) && (
            <div className="text-xs text-slate-500">
              Total stream output: {tokenCount} tokens, {charCount} chars
            </div>
          )}

          {isReconnecting && !isStreaming && streamId && (
            <div className="text-sm text-yellow-700">Reconnecting to stream {streamId}...</div>
          )}

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!isStreaming && finishedReason && (
            <div className="text-xs text-slate-500">Stream finished: {finishedReason}</div>
          )}

          {streamId && !isStreaming && !isReconnecting && (
            <button
              onClick={resumeStream}
              className="rounded-md bg-yellow-400 px-3 py-1 text-sm text-black"
            >
              Resume stream (ID: {streamId})
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Voice Input */}
          <div className="flex justify-center">
            <VoiceInput
              onTranscription={handleVoiceTranscription}
              onError={handleVoiceError}
              onStateChange={handleVoiceStateChange}
              disabled={inputDisabled}
            />
          </div>

          {/* Text Input */}
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                value={voiceTranscript || input}
                onChange={(e) => {
                  if (!isVoiceInputActive) {
                    setInput(e.target.value);
                  }
                }}
                disabled={inputDisabled || isVoiceInputActive}
                placeholder={
                  isVoiceInputActive ? 'Listening...' : 'Type your message or use voice input'
                }
                className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-indigo-500 focus:outline-none"
              />
              {voiceTranscript && (
                <div className="mt-1 text-xs text-gray-500">
                  Voice transcript (will be finalized when you stop speaking)
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!userMessageText || inputDisabled}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              disabled={!isStreaming}
              onClick={handleCancel}
              className="rounded-lg bg-red-500 px-4 py-2 text-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
