'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';

interface VoiceInputProps {
  onTranscription: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onStateChange?: (isActive: boolean) => void;
  disabled?: boolean;
}

interface TranscriptionEvent {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
}

export default function VoiceInput({
  onTranscription,
  onError,
  onStateChange,
  disabled = false,
}: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Check microphone permission on mount
  useEffect(() => {
    checkMicrophonePermission();
  }, []);

  const checkMicrophonePermission = async () => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setHasPermission(result.state === 'granted');

      result.addEventListener('change', () => {
        setHasPermission(result.state === 'granted');
      });
    } catch {
      // Fallback for browsers that don't support permissions API
      setHasPermission(null);
    }
  };

  const requestMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      setHasPermission(true);
      // Stop the test stream immediately
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setHasPermission(false);
      onError?.('Microphone permission denied');
    }
  };

  const startTranscriptionSession = async () => {
    setIsConnecting(true);

    const response = await fetch('/api/chat/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error('Failed to start transcription session');
    }

    const data = (await response.json()) as { sessionId?: string };
    if (!data.sessionId) {
      throw new Error('Missing transcription session id');
    }

    sessionIdRef.current = data.sessionId;

    await new Promise<void>((resolve, reject) => {
      const eventSource = new EventSource(`/api/chat/transcribe/${data.sessionId}`);
      eventSourceRef.current = eventSource;

      const handleReady = (event: Event) => {
        const message = event as MessageEvent<string>;
        try {
          const payload = JSON.parse(message.data) as { sessionId?: string };
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId;
          }
        } catch {
          // Ignore malformed ready payloads and rely on the created session id.
        }
        setIsConnecting(false);
        resolve();
      };

      const handleTranscription = (event: Event) => {
        try {
          const message = event as MessageEvent<string>;
          const data = JSON.parse(message.data) as TranscriptionEvent;

          setCurrentTranscript(data.transcript);
          onTranscription(data.transcript, data.isFinal);
        } catch {
          console.error('Error parsing transcription event: Unable to parse event payload');
        }
      };

      const handleServerError = (event: Event) => {
        try {
          const message = event as MessageEvent<string>;
          const data = JSON.parse(message.data) as { message?: string };
          reject(new Error(data.message || 'Transcription session failed'));
        } catch {
          reject(new Error('Transcription session failed'));
        }
      };

      const handleClose = () => {
        void stopRecording();
      };

      eventSource.addEventListener('ready', handleReady as EventListener);
      eventSource.addEventListener('transcription', handleTranscription as EventListener);
      eventSource.addEventListener('transcription-error', handleServerError as EventListener);
      eventSource.addEventListener('close', handleClose as EventListener);

      eventSource.onerror = () => {
        reject(new Error('Transcription connection lost'));
      };
    });
  };

  const startRecording = async () => {
    try {
      if (hasPermission === false) {
        await requestMicrophonePermission();
        return;
      }

      if (hasPermission === null) {
        await requestMicrophonePermission();
      }

      await startTranscriptionSession();

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && sessionIdRef.current) {
          audioChunksRef.current.push(event.data);

          // Convert blob to array buffer and send to backend
          const arrayBuffer = await event.data.arrayBuffer();

          try {
            await fetch(`/api/chat/transcribe/${sessionIdRef.current}`, {
              method: 'POST',
              body: arrayBuffer,
            });
          } catch (error) {
            console.error('Failed to send audio chunk:', error);
          }
        }
      };

      // Start recording with small time slices for real-time streaming
      mediaRecorder.start(100); // 100ms chunks
      setIsRecording(true);
      onStateChange?.(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      onError?.('Failed to access microphone');
      stopRecording();
    }
  };

  const stopRecording = useCallback(async () => {
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Close transcription session
    if (sessionIdRef.current) {
      try {
        await fetch(`/api/chat/transcribe/${sessionIdRef.current}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('Failed to close session:', error);
      }
      sessionIdRef.current = null;
    }

    setIsRecording(false);
    setIsConnecting(false);
    setCurrentTranscript('');
    onStateChange?.(false);
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  const getButtonIcon = () => {
    if (isConnecting) {
      return <Loader2 className="w-5 h-5 animate-spin" />;
    }
    if (isRecording) {
      return <Square className="w-5 h-5" />;
    }
    return <Mic className="w-5 h-5" />;
  };

  const getButtonText = () => {
    if (isConnecting) return 'Connecting...';
    if (isRecording) return 'Stop Recording';
    return 'Start Voice Input';
  };

  const getButtonClass = () => {
    if (disabled) return 'opacity-50 cursor-not-allowed';
    if (isRecording) return 'bg-red-600 hover:bg-red-700';
    return 'bg-blue-600 hover:bg-blue-700';
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Voice Input Button */}
      <button
        onClick={toggleRecording}
        disabled={disabled || isConnecting}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-white transition-colors ${getButtonClass()}`}
      >
        {getButtonIcon()}
        <span>{getButtonText()}</span>
      </button>

      {/* Permission Status */}
      {hasPermission === false && (
        <div className="text-sm text-red-600 text-center">
          <MicOff className="w-4 h-4 inline mr-1" />
          Microphone permission required
        </div>
      )}

      {/* Current Transcript Display */}
      {currentTranscript && (
        <div className="w-full max-w-md p-3 bg-gray-100 rounded-lg">
          <div className="text-sm text-gray-600 mb-1">Listening...</div>
          <div className="text-gray-900">{currentTranscript}</div>
        </div>
      )}

      {/* Recording Indicator */}
      {isRecording && (
        <div className="flex items-center space-x-2 text-red-600">
          <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
          <span className="text-sm">Recording</span>
        </div>
      )}
    </div>
  );
}
