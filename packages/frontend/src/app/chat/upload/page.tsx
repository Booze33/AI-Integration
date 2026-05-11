'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ChatHistorySession } from '../../../lib/api-client';
import { apiFetch } from '../../../lib/api/client';
import { getLoginRedirectPathForCurrentLocation } from '../../../lib/auth-redirect';
import { useFocusTrap } from '../../../lib/useFocusTrap';
import { usePageTitle } from '../../../lib/usePageTitle';
import { useChatStream } from '../../../lib/useChatStream';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  streamError?: string;
}

interface UserInfo {
  id: string;
  email: string;
  role: string;
}

const STORAGE_KEYS = {
  history: 'uploadChatHistory',
  pendingUploadContext: 'uploadChatPendingContext',
};

const SCROLL_BOTTOM_THRESHOLD_PX = 32;
const HISTORY_PAGE_SIZE = 8;
const TRANSCRIPTION_SILENCE_TIMEOUT_MS = 30_000;

interface TranscriptionPayload {
  transcript?: string;
  isFinal?: boolean;
  message?: string;
  sessionId?: string;
}

function parseSSEEvent(raw: string): { eventType: string; data: string } | null {
  const lines = raw.split('\n');
  let eventType = 'message';
  let data = '';

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
  }

  if (!data && !eventType) return null;
  return { eventType, data };
}

function formatMessageTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const output: ReactNode[] = [];
  const codeSplit = text.split(/(`[^`]+`)/g);

  codeSplit.forEach((segment, codeIndex) => {
    if (!segment) return;

    if (segment.startsWith('`') && segment.endsWith('`') && segment.length >= 2) {
      output.push(
        <code
          key={`inline-code-${codeIndex}`}
          className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-900"
        >
          {segment.slice(1, -1)}
        </code>
      );
      return;
    }

    const styleSplit = segment.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    styleSplit.forEach((part, styleIndex) => {
      if (!part) return;

      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        output.push(
          <strong key={`bold-${codeIndex}-${styleIndex}`} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
        return;
      }

      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        output.push(
          <em key={`italic-${codeIndex}-${styleIndex}`} className="italic">
            {part.slice(1, -1)}
          </em>
        );
        return;
      }

      output.push(<span key={`text-${codeIndex}-${styleIndex}`}>{part}</span>);
    });
  });

  return output;
}

function renderMessageMarkdown(content: string): ReactNode {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].startsWith('```')) {
        i += 1;
      }

      elements.push(
        <pre
          key={`code-block-${i}`}
          className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }

      elements.push(
        <ul key={`list-${i}`} className="list-disc space-y-1 pl-5">
          {listItems.map((item, index) => (
            <li key={`list-item-${i}-${index}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    elements.push(
      <p key={`paragraph-${i}`} className="leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>
    );
    i += 1;
  }

  return <div className="space-y-2">{elements}</div>;
}

function formatHistoryTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getHistoryPreview(session: ChatHistorySession): string {
  const firstUserMessage =
    session.messages.find((message) => message.role === 'user')?.content || '';
  if (!firstUserMessage) {
    return 'No user message';
  }

  const normalized = firstUserMessage.replace(/\s+/g, ' ').trim();
  return normalized.length > 60 ? `${normalized.slice(0, 60)}...` : normalized;
}

export default function ChatPage() {
  usePageTitle('Upload Chat | AI Integration Platform');
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [finishedReason, setFinishedReason] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [, setIsVoiceInputActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnectingTranscription, setIsConnectingTranscription] = useState(false);
  const [transcriptionSessionId, setTranscriptionSessionId] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySessions, setHistorySessions] = useState<ChatHistorySession[]>([]);
  const [isReadOnlyHistoryView, setIsReadOnlyHistoryView] = useState(false);
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState<string | null>(null);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [isHistoryHydrated, setIsHistoryHydrated] = useState(false);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isAtBottomRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const assistantContentRef = useRef('');
  const activeStreamIdRef = useRef<string | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const pendingCharacterQueueRef = useRef('');
  const flushCharactersRafRef = useRef<number | null>(null);
  const flushDrainResolversRef = useRef<Array<() => void>>([]);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const silenceTimeoutRef = useRef<number | null>(null);
  const transcriptionSessionIdRef = useRef<string | null>(null);
  const historyDrawerRef = useRef<HTMLDivElement | null>(null);

  const composerValue = useMemo(() => voiceTranscript || input, [input, voiceTranscript]);
  const userMessageText = useMemo(() => composerValue.trim(), [composerValue]);
  const composerCharCount = composerValue.length;
  const filteredHistorySessions = useMemo(() => {
    const term = historySearchTerm.trim().toLowerCase();
    if (!term) {
      return historySessions;
    }

    return historySessions.filter((session) => {
      const preview = getHistoryPreview(session).toLowerCase();
      const timestamp = formatHistoryTimestamp(
        session.updatedAt || session.createdAt
      ).toLowerCase();
      return preview.includes(term) || timestamp.includes(term);
    });
  }, [historySearchTerm, historySessions]);
  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredHistorySessions.length / HISTORY_PAGE_SIZE)
  );
  const pagedHistorySessions = useMemo(() => {
    const boundedPage = Math.min(historyPage, totalHistoryPages);
    const start = (boundedPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistorySessions.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistorySessions, historyPage, totalHistoryPages]);
  useFocusTrap(isHistoryOpen, historyDrawerRef, () => setIsHistoryOpen(false));

  useEffect(() => {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.history);
    let initialMessages: ChatMessage[] = [];

    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory) as ChatMessage[];
        if (Array.isArray(parsed)) {
          initialMessages = parsed.map((message) => ({
            ...message,
            createdAt: message.createdAt || new Date().toISOString(),
          }));
        }
      } catch {
        initialMessages = [];
      }
    }

    const pendingUploadContext = localStorage.getItem(STORAGE_KEYS.pendingUploadContext);
    if (pendingUploadContext) {
      try {
        const parsed = JSON.parse(pendingUploadContext) as Partial<ChatMessage>;
        if (
          parsed.role === 'system' &&
          typeof parsed.content === 'string' &&
          parsed.content.trim()
        ) {
          initialMessages = [
            ...initialMessages,
            {
              id: parsed.id || `system-${Date.now()}`,
              role: 'system',
              content: parsed.content,
              createdAt: parsed.createdAt || new Date().toISOString(),
            },
          ];
        }
      } catch {
        // Ignore malformed pending upload context
      }
    }

    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(initialMessages));
    localStorage.removeItem(STORAGE_KEYS.pendingUploadContext);
    setMessages(initialMessages);
    setIsHistoryHydrated(true);

    async function verifyAuth() {
      try {
        const response = await apiClient.getCurrentUser();
        setUser(response.user);
      } catch {
        router.replace(getLoginRedirectPathForCurrentLocation());
      } finally {
        setIsAuthResolved(true);
      }
    }

    void verifyAuth();
  }, [router]);

  useEffect(() => {
    if (!isHistoryHydrated) return;
    messagesRef.current = messages;
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(messages));
  }, [isHistoryHydrated, messages]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearchTerm]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  const appendMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  };

  const ensureAssistantDraft = useCallback(() => {
    setMessages((prev) => {
      const hasDraft = prev.some((message) => message.id === 'assistant-draft');
      if (hasDraft) {
        return prev;
      }

      return [
        ...prev,
        {
          id: 'assistant-draft',
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          streamError: undefined,
        },
      ];
    });
  }, []);

  const appendAssistantCharacters = useCallback((chars: string) => {
    if (!chars) return;

    setMessages((prev) => {
      const hasDraft = prev.some((message) => message.id === 'assistant-draft');

      if (!hasDraft) {
        return [
          ...prev,
          {
            id: 'assistant-draft',
            role: 'assistant',
            content: chars,
            createdAt: new Date().toISOString(),
            streamError: undefined,
          },
        ];
      }

      return prev.map((message) =>
        message.id === 'assistant-draft'
          ? {
              ...message,
              content: message.content + chars,
              streamError: undefined,
            }
          : message
      );
    });
  }, []);

  const setAssistantDraftError = useCallback((message: string) => {
    setMessages((prev) =>
      prev.map((item) => (item.id === 'assistant-draft' ? { ...item, streamError: message } : item))
    );
  }, []);

  const scheduleCharacterFlush = useCallback(() => {
    if (flushCharactersRafRef.current !== null) {
      return;
    }

    const flushCharacters = () => {
      flushCharactersRafRef.current = null;

      if (!pendingCharacterQueueRef.current.length) {
        const resolvers = flushDrainResolversRef.current.splice(0);
        resolvers.forEach((resolve) => resolve());
        return;
      }

      const charsForFrame = pendingCharacterQueueRef.current.slice(0, 12);
      pendingCharacterQueueRef.current = pendingCharacterQueueRef.current.slice(12);
      appendAssistantCharacters(charsForFrame);

      if (pendingCharacterQueueRef.current.length) {
        scheduleCharacterFlush();
      } else {
        const resolvers = flushDrainResolversRef.current.splice(0);
        resolvers.forEach((resolve) => resolve());
      }
    };

    flushCharactersRafRef.current = requestAnimationFrame(flushCharacters);
  }, [appendAssistantCharacters]);

  const enqueueAssistantChunk = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      pendingCharacterQueueRef.current += chunk;
      scheduleCharacterFlush();
    },
    [scheduleCharacterFlush]
  );

  const drainCharacterQueue = useCallback(async () => {
    if (!pendingCharacterQueueRef.current.length && flushCharactersRafRef.current === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      flushDrainResolversRef.current.push(resolve);
      scheduleCharacterFlush();
    });
  }, [scheduleCharacterFlush]);

  const finalizeAssistant = () => {
    setMessages((prev) =>
      prev.map((m) => (m.id === 'assistant-draft' ? { ...m, id: `assistant-${Date.now()}` } : m))
    );
  };

  const handleStreamStart = useCallback(
    (payload: { streamId?: string; id?: string }) => {
      const nextStreamId = payload.streamId || payload.id || null;
      activeStreamIdRef.current = nextStreamId;
      setFinishedReason('');
      ensureAssistantDraft();
    },
    [ensureAssistantDraft]
  );

  const handleStreamChunk = useCallback(
    (chunk: string) => {
      assistantContentRef.current += chunk;
      enqueueAssistantChunk(chunk);

      const incomingText = chunk.trim();
      const tokens = incomingText ? incomingText.split(/\s+/).filter(Boolean).length : 0;
      setTokenCount((prev) => prev + tokens);
      setCharCount((prev) => prev + chunk.length);
    },
    [enqueueAssistantChunk]
  );

  const handleStreamDone = useCallback(
    async (payload: { finishReason?: string }) => {
      await drainCharacterQueue();
      setFinishedReason(payload.finishReason || 'stop');
      finalizeAssistant();
      assistantContentRef.current = '';
      activeStreamIdRef.current = null;
    },
    [drainCharacterQueue]
  );

  const handleStreamError = useCallback(
    async (streamErrorMessage: string) => {
      await drainCharacterQueue();
      setError(streamErrorMessage);
      setAssistantDraftError(streamErrorMessage);
    },
    [drainCharacterQueue, setAssistantDraftError]
  );

  const {
    start: startStream,
    abort: abortStream,
    isStreaming,
    error: streamError,
    streamId,
    transport,
  } = useChatStream({
    onStart: handleStreamStart,
    onChunk: handleStreamChunk,
    onDone: handleStreamDone,
    onError: handleStreamError,
  });

  const startChat = async (userText: string) => {
    if (isReadOnlyHistoryView) {
      setError('This is a read-only history conversation. Start a new chat to continue.');
      return;
    }

    const trimmed = userText.trim();
    if (!trimmed) return;

    setError(null);
    setFinishedReason('');
    setTokenCount(0);
    setCharCount(0);
    assistantContentRef.current = '';

    const newUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    appendMessage(newUserMessage);
    ensureAssistantDraft();

    const payload = [
      ...messagesRef.current.filter((m) => m.role !== 'assistant' || m.id !== 'assistant-draft'),
      newUserMessage,
    ];
    chatSessionIdRef.current ??= crypto.randomUUID();
    await startStream(payload, chatSessionIdRef.current);
  };

  const handleConfirmNewChat = () => {
    abortStream();
    void stopTranscription();
    setMessages([]);
    setError(null);
    setFinishedReason('');
    setTokenCount(0);
    setCharCount(0);
    setInput('');
    setVoiceTranscript('');
    setShowNewChatConfirm(false);
    setIsReadOnlyHistoryView(false);
    setSelectedHistorySessionId(null);
    assistantContentRef.current = '';
    activeStreamIdRef.current = null;
    chatSessionIdRef.current = null;
  };

  const openHistoryDrawer = async () => {
    setIsHistoryOpen(true);
    setHistoryError(null);
    setIsHistoryLoading(true);
    setHistoryPage(1);

    try {
      const response = await apiClient.getChatHistory();
      setHistorySessions(response.sessions || []);
    } catch (historyFetchError) {
      setHistoryError(
        historyFetchError instanceof Error
          ? historyFetchError.message
          : 'Failed to load chat history'
      );
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadHistorySession = (session: ChatHistorySession) => {
    abortStream();
    void stopTranscription();
    setError(null);
    setFinishedReason('');
    setTokenCount(0);
    setCharCount(0);
    setInput('');
    setVoiceTranscript('');
    setShowNewChatConfirm(false);

    const loadedMessages: ChatMessage[] = session.messages.map((message, index) => ({
      id: message.id || `${session.sessionId}-${index}`,
      role: message.role,
      content: message.content,
      createdAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    }));

    setMessages(loadedMessages);
    setIsReadOnlyHistoryView(true);
    setSelectedHistorySessionId(session.sessionId);
    setIsHistoryOpen(false);
    chatSessionIdRef.current = null;
  };

  const retryInlineStream = async () => {
    if (isStreaming) return;

    setError(null);
    setFinishedReason('');
    setMessages((prev) =>
      prev.map((message) =>
        message.id === 'assistant-draft' ? { ...message, streamError: undefined } : message
      )
    );

    const assistantDraft = messagesRef.current.find((message) => message.id === 'assistant-draft');
    assistantContentRef.current = assistantDraft?.content || '';

    const payload = messagesRef.current.filter(
      (message) => message.role !== 'assistant' || message.id !== 'assistant-draft'
    );
    await startStream(payload, chatSessionIdRef.current ?? undefined);
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    } catch {
      setError('Failed to copy message');
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    startChat(userMessageText);
    setInput('');
    setVoiceTranscript('');
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isStreaming && userMessageText) {
        startChat(userMessageText);
        setInput('');
        setVoiceTranscript('');
      }
    }
  };

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimeoutRef.current) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const stopTranscription = useCallback(async () => {
    setIsRecording(false);
    setIsConnectingTranscription(false);
    setIsVoiceInputActive(false);
    clearSilenceTimer();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
    }

    if (transcriptionAbortRef.current) {
      transcriptionAbortRef.current.abort();
      transcriptionAbortRef.current = null;
    }

    if (transcriptionSessionIdRef.current) {
      try {
        await apiFetch(`/api/chat/transcribe/${transcriptionSessionIdRef.current}`, {
          method: 'DELETE',
        });
      } catch (closeError) {
        console.error('Failed to close transcription session:', closeError);
      }
      transcriptionSessionIdRef.current = null;
      setTranscriptionSessionId(null);
    }
  }, [clearSilenceTimer]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimeoutRef.current = window.setTimeout(() => {
      void stopTranscription();
    }, TRANSCRIPTION_SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, stopTranscription]);

  const startTranscription = useCallback(async () => {
    if (isStreaming || isReadOnlyHistoryView || isRecording || isConnectingTranscription) {
      return;
    }

    setTranscriptionError(null);
    setIsConnectingTranscription(true);

    try {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const mediaRecorder = new MediaRecorder(microphoneStream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      microphoneStreamRef.current = microphoneStream;
      mediaRecorderRef.current = mediaRecorder;
      setIsVoiceInputActive(true);
      setIsRecording(true);

      mediaRecorder.ondataavailable = async (event) => {
        if (!event.data.size || !transcriptionSessionIdRef.current) {
          return;
        }

        try {
          const chunk = await event.data.arrayBuffer();
          await apiFetch(`/api/chat/transcribe/${transcriptionSessionIdRef.current}`, {
            method: 'POST',
            body: chunk,
          });
        } catch (chunkError) {
          console.error('Failed to send audio chunk:', chunkError);
        }
      };

      mediaRecorder.start(200);

      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;

      const response = await apiFetch('/api/chat/transcribe', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect transcription stream');
      }

      setIsConnectingTranscription(false);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let separatorIndex = -1;
        while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = parseSSEEvent(rawEvent);
          if (!parsed) continue;

          const { eventType, data } = parsed;
          let payload: TranscriptionPayload = {};
          if (data) {
            try {
              payload = JSON.parse(data) as TranscriptionPayload;
            } catch {
              payload = { transcript: data };
            }
          }

          if (eventType === 'ready') {
            if (payload.sessionId) {
              transcriptionSessionIdRef.current = payload.sessionId;
              setTranscriptionSessionId(payload.sessionId);
            }
            continue;
          }

          if (eventType === 'transcription') {
            resetSilenceTimer();
            const transcript = payload.transcript || '';
            if (payload.isFinal) {
              setInput(transcript);
              setVoiceTranscript('');
            } else {
              setVoiceTranscript(transcript);
            }
            continue;
          }

          if (eventType === 'transcription-error') {
            setTranscriptionError(payload.message || 'Transcription error');
            await stopTranscription();
            return;
          }

          if (eventType === 'close') {
            await stopTranscription();
            return;
          }
        }
      }

      await stopTranscription();
    } catch (transcriptionStartError) {
      if (
        transcriptionStartError instanceof DOMException &&
        (transcriptionStartError.name === 'NotAllowedError' ||
          transcriptionStartError.name === 'SecurityError')
      ) {
        setTranscriptionError('Microphone permission denied');
      } else {
        setTranscriptionError(
          transcriptionStartError instanceof Error
            ? transcriptionStartError.message
            : 'Failed to start transcription'
        );
      }
      await stopTranscription();
    }
  }, [
    isStreaming,
    isReadOnlyHistoryView,
    isRecording,
    isConnectingTranscription,
    resetSilenceTimer,
    stopTranscription,
  ]);

  const toggleTranscription = () => {
    if (isRecording || isConnectingTranscription) {
      void stopTranscription();
      return;
    }
    void startTranscription();
  };

  useEffect(() => {
    return () => {
      abortStream();
      void stopTranscription();
      if (flushCharactersRafRef.current !== null) {
        cancelAnimationFrame(flushCharactersRafRef.current);
      }
    };
  }, [abortStream, stopTranscription]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const computedLineHeight = Number.parseInt(getComputedStyle(textarea).lineHeight || '24', 10);
    const maxHeight = computedLineHeight * 6;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [composerValue]);

  const scrollToBottom = () => {
    const listElement = messageListRef.current;
    if (!listElement) return;

    listElement.scrollTop = listElement.scrollHeight;
    isAtBottomRef.current = true;
    setShowScrollToBottom(false);
  };

  const handleMessageListScroll = () => {
    const listElement = messageListRef.current;
    if (!listElement) return;

    const distanceFromBottom =
      listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight;
    const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;
    isAtBottomRef.current = atBottom;

    if (atBottom) {
      setShowScrollToBottom(false);
    }
  };

  useEffect(() => {
    const isNewMessage = messages.length > previousMessageCountRef.current;

    if (isNewMessage) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(scrollToBottom);
      } else {
        setShowScrollToBottom(true);
      }
    } else if (isStreaming && isAtBottomRef.current) {
      requestAnimationFrame(scrollToBottom);
    }

    previousMessageCountRef.current = messages.length;
  }, [isStreaming, messages]);

  if (!isAuthResolved) {
    return (
      <div className="min-h-screen bg-slate-100 p-0 md:p-6 overflow-x-hidden">
        <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl items-center justify-center rounded-none bg-white p-4 shadow-lg md:h-[calc(100vh-3rem)] md:rounded-2xl md:p-6">
          <div className="inline-flex items-center gap-3 text-sm text-slate-600">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"></span>
            Verifying session...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

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
    <div className="min-h-screen bg-slate-100 p-0 md:p-6 overflow-x-hidden">
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col rounded-none bg-white p-4 shadow-lg md:h-[calc(100vh-3rem)] md:rounded-2xl md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Streaming AI Chat</h1>
            {user && (
              <p className="text-sm text-gray-500">
                Signed in as {user.email} ({user.role})
              </p>
            )}
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
              <span
                className={`h-2 w-2 rounded-full ${
                  transport === 'websocket'
                    ? 'bg-emerald-500'
                    : transport === 'sse'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                }`}
              ></span>
              {transport === 'websocket'
                ? 'Connected via WebSocket'
                : transport === 'sse'
                  ? 'Connected via SSE fallback'
                  : 'Transport: idle'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!showNewChatConfirm ? (
              <button
                type="button"
                onClick={() => setShowNewChatConfirm(true)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                New Chat
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs">
                <span className="text-amber-900">Are you sure?</span>
                <button
                  type="button"
                  onClick={handleConfirmNewChat}
                  className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewChatConfirm(false)}
                  className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={openHistoryDrawer}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              History
            </button>
          </div>
        </div>

        {isReadOnlyHistoryView && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Viewing past conversation in read-only mode.
          </div>
        )}

        <div className="relative mt-6 flex-1 min-h-0">
          <div
            ref={messageListRef}
            onScroll={handleMessageListScroll}
            className="flex h-full flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 pb-32 md:pb-4"
          >
            {messages.map((message) => {
              const roleLabel =
                message.role === 'user'
                  ? 'You'
                  : message.role === 'assistant'
                    ? 'Assistant'
                    : 'System';
              const isDraftAssistant =
                message.id === 'assistant-draft' && message.role === 'assistant';

              return (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-xl border px-4 py-3 ${
                    message.role === 'user'
                      ? 'self-end border-blue-200 bg-blue-50 text-blue-950'
                      : 'self-start border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        message.role === 'user'
                          ? 'bg-blue-200 text-blue-900'
                          : message.role === 'assistant'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {roleLabel}
                    </span>
                    <div className="flex items-center gap-2 text-slate-500">
                      <span>{formatMessageTimestamp(message.createdAt)}</span>
                      {message.role === 'assistant' && !isDraftAssistant && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(message.id, message.content)}
                          className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                        >
                          {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-sm">{renderMessageMarkdown(message.content)}</div>

                  {isDraftAssistant && isStreaming && !message.streamError && (
                    <div className="mt-2 inline-flex items-center text-slate-500">
                      <span className="h-4 w-0.5 animate-pulse bg-slate-500"></span>
                    </div>
                  )}

                  {isDraftAssistant && message.streamError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <p>{message.streamError}</p>
                      <button
                        type="button"
                        onClick={retryInlineStream}
                        className="mt-1 font-semibold underline"
                      >
                        retry
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

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

            {(error || streamError) && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                {error || streamError}
              </div>
            )}

            {!isStreaming && finishedReason && (
              <div className="text-xs text-slate-500">Stream finished: {finishedReason}</div>
            )}

            {streamId && <div className="text-xs text-slate-500">Stream ID: {streamId}</div>}
          </div>

          {showScrollToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 right-4 min-h-11 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-indigo-700"
            >
              Scroll to bottom
            </button>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] md:static md:mt-4 md:space-y-4 md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:shadow-none"
        >
          {/* Text Input */}
          <div className="mx-auto flex max-w-4xl items-end gap-2">
            <div className="flex-1 space-y-2">
              <label htmlFor="upload-chat-message-input" className="sr-only">
                Message input
              </label>
              <textarea
                id="upload-chat-message-input"
                ref={textareaRef}
                rows={1}
                value={composerValue}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (voiceTranscript) {
                    setVoiceTranscript('');
                  }
                }}
                onKeyDown={handleComposerKeyDown}
                disabled={isStreaming || isReadOnlyHistoryView}
                placeholder={
                  isReadOnlyHistoryView
                    ? 'Read-only history. Start a new chat to send messages.'
                    : isRecording || isConnectingTranscription
                      ? 'Listening...'
                      : 'Type your message or use voice input'
                }
                className={`w-full resize-none rounded-lg border border-slate-300 px-4 py-2 focus:border-indigo-500 focus:outline-none ${
                  voiceTranscript ? 'text-slate-500' : 'text-slate-900'
                }`}
              />
              {composerCharCount > 2000 && (
                <div
                  className={`text-xs text-right ${
                    composerCharCount > 4000 ? 'text-red-600 font-medium' : 'text-slate-500'
                  }`}
                >
                  {composerCharCount} characters
                </div>
              )}
              {(isRecording || isConnectingTranscription) && (
                <div className="mt-1 inline-flex items-center gap-2 text-xs text-red-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse"></span>
                  Recording
                  {transcriptionSessionId ? ` (${transcriptionSessionId})` : ''}
                </div>
              )}
              {transcriptionError && (
                <div className="text-xs text-red-600">{transcriptionError}</div>
              )}
              <div className="text-xs text-slate-500">AI responses may be inaccurate.</div>
            </div>

            <button
              type="button"
              onClick={toggleTranscription}
              disabled={isStreaming || isReadOnlyHistoryView}
              className={`min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                isRecording || isConnectingTranscription
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-slate-700 hover:bg-slate-800'
              } disabled:opacity-50`}
            >
              {isConnectingTranscription ? 'Connecting...' : isRecording ? 'Stop Mic' : 'Mic'}
            </button>

            <button
              type={isStreaming ? 'button' : 'submit'}
              disabled={!isStreaming && (!userMessageText || isReadOnlyHistoryView)}
              onClick={isStreaming ? abortStream : undefined}
              className={`min-h-11 rounded-lg px-4 py-2 text-white ${
                isStreaming
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
              }`}
            >
              {isStreaming ? 'Abort' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {isHistoryOpen && (
        <div className="fixed inset-0 z-30 flex items-end bg-slate-900/30 md:items-stretch md:justify-end">
          <div
            ref={historyDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-chat-history-title"
            tabIndex={-1}
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl md:h-full md:max-h-none md:max-w-md md:rounded-none md:border-l md:border-t-0"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="upload-chat-history-title" className="text-lg font-semibold text-slate-900">
                Conversation History
              </h2>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {isHistoryLoading && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="h-3 w-4/5 rounded skeleton-shimmer"></div>
                    <div className="mt-2 h-3 w-1/3 rounded skeleton-shimmer"></div>
                  </div>
                ))}
              </div>
            )}

            {!isHistoryLoading && historyError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {historyError}
              </div>
            )}

            {!isHistoryLoading && !historyError && (
              <div className="space-y-3">
                <label htmlFor="upload-chat-history-search" className="sr-only">
                  Search conversation history
                </label>
                <input
                  id="upload-chat-history-search"
                  value={historySearchTerm}
                  onChange={(event) => setHistorySearchTerm(event.target.value)}
                  placeholder="Search history..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />

                <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-13rem)] pr-1">
                  {filteredHistorySessions.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                        🗂️
                      </div>
                      <p className="text-sm font-semibold text-slate-900">
                        No conversations yet. Start a new chat.
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Conversations will appear here after you send your first message.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          handleConfirmNewChat();
                          setIsHistoryOpen(false);
                        }}
                        className="mt-3 min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                      >
                        Start New Chat
                      </button>
                    </div>
                  ) : (
                    pagedHistorySessions.map((session) => (
                      <button
                        key={session.sessionId}
                        type="button"
                        onClick={() => loadHistorySession(session)}
                        className={`w-full rounded-lg border p-3 text-left hover:bg-slate-50 ${
                          selectedHistorySessionId === session.sessionId
                            ? 'border-indigo-300 bg-indigo-50'
                            : 'border-slate-200'
                        }`}
                      >
                        <p className="text-sm font-medium text-slate-900">
                          {getHistoryPreview(session)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatHistoryTimestamp(session.updatedAt || session.createdAt)}
                        </p>
                      </button>
                    ))
                  )}
                </div>

                {filteredHistorySessions.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Page {Math.min(historyPage, totalHistoryPages)} of {totalHistoryPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                        disabled={historyPage <= 1}
                        className="min-h-11 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))
                        }
                        disabled={historyPage >= totalHistoryPages}
                        className="min-h-11 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
