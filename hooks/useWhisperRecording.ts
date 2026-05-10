import { useState, useRef, useCallback, useEffect } from 'react';
import {
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import type { AudioRecorder, RecordingOptions } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { InteractionManager } from 'react-native';
import { initWhisper, WhisperContext } from 'whisper.rn';
import { ensureModelAvailable } from '../services/modelService';

type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

interface UseWhisperRecordingReturn {
  isRecording: boolean;
  isProcessing: boolean;
  transcription: string | null;
  error: string | null;
  modelDownloadProgress: number | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  isReady: boolean;
}

const WHISPER_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

const resetAudioModeAfterRecording = () =>
  setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: false,
    shouldPlayInBackground: false,
  });

/**
 * Hook for recording audio and transcribing with whisper.rn.
 * Handles model initialization, audio recording, and transcription.
 * Uses "record then transcribe" workflow (not live streaming).
 */
export function useWhisperRecording(): UseWhisperRecordingReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcription, setTranscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const audioRecorder = useAudioRecorder(WHISPER_RECORDING_OPTIONS);
  
  const recordingRef = useRef<AudioRecorder | null>(null);
  const whisperContextRef = useRef<WhisperContext | null>(null);
  const transcribeStopRef = useRef<(() => Promise<void>) | null>(null);

  // Initialize whisper model after the first UI interactions settle.
  useEffect(() => {
    let isMounted = true;
    let prewarmTimer: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: { cancel?: () => void } | null = null;
    
    async function initializeWhisper() {
      try {
        // Ensure model is available (downloads if needed)
        const modelPath = await ensureModelAvailable((progress) => {
          if (isMounted) {
            setModelDownloadProgress(progress);
          }
        });
        
        if (!isMounted) return;
        
        // Initialize whisper.rn with the model
        const context = await initWhisper({
          filePath: modelPath,
        });
        
        if (!isMounted) {
          // Clean up if component unmounted during init
          await context.release();
          return;
        }
        
        whisperContextRef.current = context;
        setIsReady(true);
        setModelDownloadProgress(null);
        setError(null);
      } catch (err) {
        console.error('Failed to initialize whisper:', err);
        if (isMounted) {
          setModelDownloadProgress(null);
          setError(err instanceof Error ? err.message : 'Failed to initialize whisper model');
          setIsReady(false);
        }
      }
    }
    
    prewarmTimer = setTimeout(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        initializeWhisper();
      });
    }, 800);
    
    // Cleanup function
    return () => {
      isMounted = false;
      if (prewarmTimer) {
        clearTimeout(prewarmTimer);
      }
      interactionTask?.cancel?.();
      
      // Stop any active transcription
      if (transcribeStopRef.current) {
        transcribeStopRef.current().catch(console.error);
      }
      
      // Stop and cleanup recording if active
      if (recordingRef.current) {
        recordingRef.current.stop().catch(console.error);
      }
      
      // Release whisper context
      if (whisperContextRef.current) {
        whisperContextRef.current.release().catch(console.error);
      }
    };
  }, []);

  /**
   * Request microphone permissions and start recording.
   * Configures audio session to continue recording when screen is off.
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscription(null);
      
      // Request microphone permissions.
      const permissionResponse = await requestRecordingPermissionsAsync();
      if (!permissionResponse.granted) {
        throw new Error('Microphone permission denied');
      }
      
      // Configure audio mode for recording with background support.
      // shouldPlayInBackground allows recording to continue when screen is off.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
      
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingRef.current = audioRecorder;
      setRecordingState('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setRecordingState('error');
      recordingRef.current = null;
      resetAudioModeAfterRecording().catch(console.error);
    }
  }, [audioRecorder]);

  /**
   * Stop recording and transcribe the audio.
   */
  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) {
      return;
    }

    const recording = recordingRef.current;
    let uriForCleanup: string | null = null;
    
    try {
      setRecordingState('processing');
      
      // Stop and get the recording URI
      await recording.stop();
      uriForCleanup = recording.uri ?? recording.getStatus().url ?? null;

      await resetAudioModeAfterRecording();
      
      if (!uriForCleanup) {
        throw new Error('No recording URI available');
      }

      // Clean up recording reference
      recordingRef.current = null;
      
      // Transcribe using whisper.rn
      if (!whisperContextRef.current) {
        throw new Error('Whisper not initialized');
      }
      
      // Transcribe the audio file
      // whisper.rn's transcribe method returns { stop, promise }
      const { stop, promise } = whisperContextRef.current.transcribe(uriForCleanup, {
        language: 'en',
      });
      
      // Store stop function in case we need to cancel
      transcribeStopRef.current = stop;
      
      // Wait for transcription result
      const result = await promise;
      
      // Extract transcription text from result
      const transcribedText = result.result || '';
      
      setTranscription(transcribedText);
      setRecordingState('idle');
    } catch (err) {
      console.error('Failed to transcribe:', err);
      setError(err instanceof Error ? err.message : 'Failed to transcribe audio');
      setRecordingState('error');
      
      if (!uriForCleanup) {
        try {
          uriForCleanup = recording.uri ?? recording.getStatus().url ?? null;
        } catch (cleanupErr) {
          console.error('Failed to find recording for cleanup:', cleanupErr);
        }
      }
      resetAudioModeAfterRecording().catch(console.error);
    } finally {
      transcribeStopRef.current = null;
      recordingRef.current = null;

      if (uriForCleanup) {
        try {
          await FileSystem.deleteAsync(uriForCleanup, { idempotent: true });
        } catch (cleanupErr) {
          console.error('Failed to delete recording file:', cleanupErr);
        }
      }
    }
  }, []);

  return {
    isRecording: recordingState === 'recording',
    isProcessing: recordingState === 'processing',
    transcription,
    error,
    modelDownloadProgress,
    startRecording,
    stopRecording,
    isReady,
  };
}
