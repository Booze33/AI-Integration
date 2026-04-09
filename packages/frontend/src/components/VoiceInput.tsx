'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';
// import { apiClient } from '../lib/api-client';

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
    try {
      setIsConnecting(true);

      // Note: We don't have a transcription session method in api-client yet
      // We'll keep this as a direct fetch for now
      const response = await fetch('/api/chat/transcribe', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to start transcription session');
      }

      const eventSource = new EventSource('/api/chat/transcribe');
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.sessionId) {
            sessionIdRef.current = data.sessionId;
            setIsConnecting(false);
            return;
          }

          if (data.transcript) {
            const transcription: TranscriptionEvent = {
              transcript: data.transcript,
              isFinal: data.isFinal,
              confidence: data.confidence,
            };

            setCurrentTranscript(transcription.transcript);
            onTranscription(transcription.transcript, transcription.isFinal);
          }

          if (data.error) {
            onError?.(data.error);
          }
        } catch {
          console.error('Error parsing transcription event: Unable to parse event payload');
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        onError?.('Transcription connection lost');
        stopRecording();
      };
    } catch {
      console.error('Failed to start transcription session: Unknown error');
      setIsConnecting(false);
      onError?.('Failed to start transcription');
    }
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

      // Start transcription session
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
            // Note: We don't have a send audio chunk method in api-client yet
            // We'll keep this as a direct fetch for now
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
        // Note: We don't have a close session method in api-client yet
        // We'll keep this as a direct fetch for now
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
