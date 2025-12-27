import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { initWhisper, WhisperContext } from 'whisper.rn';
import { ensureModelAvailable } from '../services/modelService';

type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

interface UseWhisperRecordingReturn {
  isRecording: boolean;
  isProcessing: boolean;
  transcription: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  isReady: boolean;
}

/**
 * Hook for recording audio and transcribing with whisper.rn.
 * Handles model initialization, audio recording, and transcription.
 * Uses "record then transcribe" workflow (not live streaming).
 */
export function useWhisperRecording(): UseWhisperRecordingReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcription, setTranscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  const recordingRef = useRef<Audio.Recording | null>(null);
  const whisperContextRef = useRef<WhisperContext | null>(null);
  const transcribeStopRef = useRef<(() => Promise<void>) | null>(null);

  // Initialize whisper model on mount
  useEffect(() => {
    let isMounted = true;
    
    async function initializeWhisper() {
      try {
        // Ensure model is available (downloads if needed)
        const modelPath = await ensureModelAvailable();
        
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
        setError(null);
      } catch (err) {
        console.error('Failed to initialize whisper:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize whisper model');
          setIsReady(false);
        }
      }
    }
    
    initializeWhisper();
    
    // Cleanup function
    return () => {
      isMounted = false;
      
      // Stop any active transcription
      if (transcribeStopRef.current) {
        transcribeStopRef.current().catch(console.error);
      }
      
      // Stop and cleanup recording if active
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(console.error);
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
      const permissionResponse = await Audio.requestPermissionsAsync();
      if (!permissionResponse.granted) {
        throw new Error('Microphone permission denied');
      }
      
      // Configure audio mode for recording with background support.
      // staysActiveInBackground allows recording to continue when screen is off.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      
      // Create and configure recording.
      // We start from Expo's HIGH_QUALITY preset (which we know works)
      // and then tighten the iOS settings to a simple 16 kHz mono
      // linear PCM .wav file, which Whisper handles very well.
      const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY;
      const options = {
        ...preset,
        ios: {
          ...preset.ios,
          extension: '.wav',
          // LINEARPCM output. The enum value is 'lpcm' but at runtime
          // this is just a string, so we inline it here instead of
          // pulling more constants into the app.
          outputFormat: 'lpcm',
          sampleRate: 16000,
          numberOfChannels: 1,
          // Keep a reasonable bitrate; iOS will interpret this
          // alongside the PCM settings above.
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      };

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(options as any);
      
      await recording.startAsync();
      recordingRef.current = recording;
      setRecordingState('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setRecordingState('error');
    }
  }, []);

  /**
   * Stop recording and transcribe the audio.
   */
  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) {
      console.log('[Whisper] stopRecording called but no active recording.');
      return;
    }
    
    try {
      console.log('[Whisper] Stopping recording and starting processing.');
      setRecordingState('processing');
      
      // Stop and get the recording URI
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      console.log('[Whisper] Recording stopped. URI:', uri);
      
      if (!uri) {
        throw new Error('No recording URI available');
      }
      
      // Reset audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
      });
      
      // Clean up recording reference
      const recording = recordingRef.current;
      recordingRef.current = null;
      
      // Transcribe using whisper.rn
      if (!whisperContextRef.current) {
        throw new Error('Whisper not initialized');
      }
      
      // Transcribe the audio file
      // whisper.rn's transcribe method returns { stop, promise }
      const { stop, promise } = whisperContextRef.current.transcribe(uri, {
        language: 'en',
      });
      console.log('[Whisper] Transcription started.');
      
      // Store stop function in case we need to cancel
      transcribeStopRef.current = stop;
      
      // Wait for transcription result
      const result = await promise;
      console.log('[Whisper] Transcription finished. Raw result:', result);
      
      // Extract transcription text from result
      const transcribedText = result.result || '';
      
      setTranscription(transcribedText);
      setRecordingState('idle');
      transcribeStopRef.current = null;
      
      // Clean up the recording file
      try {
        await FileSystem.deleteAsync(uri);
      } catch (cleanupErr) {
        console.error('Failed to delete recording file:', cleanupErr);
      }
    } catch (err) {
      console.error('Failed to transcribe:', err);
      setError(err instanceof Error ? err.message : 'Failed to transcribe audio');
      setRecordingState('error');
      transcribeStopRef.current = null;
      
      // Clean up on error
      if (recordingRef.current) {
        try {
          const existingUri = recordingRef.current.getURI();
          if (existingUri) {
            await FileSystem.deleteAsync(existingUri);
          }
        } catch (cleanupErr) {
          console.error('Failed to cleanup recording:', cleanupErr);
        }
        recordingRef.current = null;
      }
    }
  }, []);

  return {
    isRecording: recordingState === 'recording',
    isProcessing: recordingState === 'processing',
    transcription,
    error,
    startRecording,
    stopRecording,
    isReady,
  };
}

