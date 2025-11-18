import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useWhisperRecording } from './hooks/useWhisperRecording';
import { useState, useEffect } from 'react';
import { ensureModelAvailable } from './services/modelService';

export default function App() {
  const {
    isRecording,
    isProcessing,
    transcription,
    error,
    startRecording,
    stopRecording,
    isReady,
  } = useWhisperRecording();
  
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number | null>(null);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);

  // Check model availability on mount
  useEffect(() => {
    async function checkModel() {
      try {
        const modelPath = await ensureModelAvailable((progress) => {
          setModelDownloadProgress(progress);
          setIsDownloadingModel(progress < 1);
        });
        setIsDownloadingModel(false);
        setModelDownloadProgress(null);
      } catch (err) {
        console.error('Model check failed:', err);
      }
    }
    
    if (!isReady) {
      checkModel();
    }
  }, [isReady]);

  const handleRecordPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.content}>
        <Text style={styles.title}>Little AI</Text>
        <Text style={styles.subtitle}>Speech to Text</Text>
        
        {/* Model download status */}
        {isDownloadingModel && (
          <View style={styles.downloadContainer}>
            <Text style={styles.downloadText}>
              Downloading model... {modelDownloadProgress ? Math.round(modelDownloadProgress * 100) : 0}%
            </Text>
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        )}
        
        {/* Ready status */}
        {isReady && !isDownloadingModel && (
          <Text style={styles.readyText}>Ready to record</Text>
        )}
        
        {/* Error display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        
        {/* Recording button */}
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording && styles.recordButtonActive,
            (!isReady || isProcessing) && styles.recordButtonDisabled,
          ]}
          onPress={handleRecordPress}
          disabled={!isReady || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <Text style={styles.recordButtonText}>
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </Text>
          )}
        </TouchableOpacity>
        
        {/* Recording indicator */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording...</Text>
          </View>
        )}
        
        {/* Transcription display */}
        {transcription !== null && (
          <ScrollView style={styles.transcriptionContainer}>
            <Text style={styles.transcriptionLabel}>Transcription:</Text>
            <Text style={styles.transcriptionText}>
              {transcription.trim().length > 0 ? transcription : 'No speech detected in this recording.'}
            </Text>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#000',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 40,
  },
  downloadContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  downloadText: {
    fontSize: 14,
    color: '#666',
  },
  readyText: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 20,
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    maxWidth: '100%',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
  recordButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 25,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  recordButtonActive: {
    backgroundColor: '#FF3B30',
  },
  recordButtonDisabled: {
    backgroundColor: '#CCC',
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  recordingText: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '500',
  },
  transcriptionContainer: {
    width: '100%',
    maxHeight: 300,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  transcriptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  transcriptionText: {
    fontSize: 16,
    color: '#000',
    lineHeight: 24,
  },
});


