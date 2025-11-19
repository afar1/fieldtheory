import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
  Pressable,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useWhisperRecording } from './hooks/useWhisperRecording';
import { ensureModelAvailable } from './services/modelService';

type TranscriptEntry = {
  id: string;
  text: string;
  createdAt: number;
};

const MAX_PREVIEW_LINES = 3;
const dateHeaderFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
});

const getDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const formatDateHeader = (timestamp: number) => dateHeaderFormatter.format(new Date(timestamp));
const formatTime = (timestamp: number) => timeFormatter.format(new Date(timestamp));

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
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep copying feedback timers tidy.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Ensure the Whisper model is available before we allow recordings.
  useEffect(() => {
    async function checkModel() {
      try {
        await ensureModelAvailable((progress) => {
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

  // Capture every finished transcription so we can build the timeline.
  useEffect(() => {
    if (transcription === null) {
      return;
    }

    const cleanedText =
      transcription.trim().length > 0
        ? transcription.trim()
        : 'No speech detected in this recording.';

    setTranscripts((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: cleanedText,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
  }, [transcription]);

  const sortedTranscripts = useMemo(() => {
    return [...transcripts].sort((a, b) =>
      sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
    );
  }, [transcripts, sortOrder]);

  const sections = useMemo(() => {
    const grouped: { key: string; title: string; data: TranscriptEntry[] }[] = [];
    const sectionIndex: Record<string, number> = {};

    sortedTranscripts.forEach((entry) => {
      const key = getDateKey(entry.createdAt);

      if (sectionIndex[key] === undefined) {
        sectionIndex[key] = grouped.length;
        grouped.push({
          key,
          title: formatDateHeader(entry.createdAt),
          data: [],
        });
      }

      grouped[sectionIndex[key]].data.push(entry);
    });

    return grouped;
  }, [sortedTranscripts]);

  const handleRecordPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const handleCopyTranscript = async (entry: TranscriptEntry) => {
    await Clipboard.setStringAsync(entry.text);
    setCopiedId(entry.id);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500);
  };

  const handleToggleExpand = (id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleDeleteTranscript = (id: string) => {
    Alert.alert('Delete transcription?', 'This removes the text from your device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setTranscripts((prev) => prev.filter((entry) => entry.id !== id));
          setExpandedMap((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        },
      },
    ]);
  };

  const renderTranscriptItem = ({ item }: { item: TranscriptEntry }) => {
    const isExpanded = Boolean(expandedMap[item.id]);
    const isCopied = copiedId === item.id;
    const shouldShowExpand = item.text.length > 160 || item.text.includes('\n');

    const handleExpandPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleToggleExpand(item.id);
    };

    return (
      <Pressable
        onPress={() => handleCopyTranscript(item)}
        onLongPress={() => handleDeleteTranscript(item.id)}
        android_ripple={{ color: '#E2E8F0' }}
        style={({ pressed }) => [
          styles.transcriptCard,
          pressed && styles.transcriptCardPressed,
          isCopied && styles.transcriptCardCopied,
        ]}
      >
        <View style={styles.transcriptHeader}>
          <Text style={styles.transcriptTime}>{formatTime(item.createdAt)}</Text>
          {isCopied && <Text style={styles.copiedLabel}>Copied</Text>}
        </View>
        <Text
          style={styles.transcriptText}
          numberOfLines={isExpanded ? undefined : MAX_PREVIEW_LINES}
        >
          {item.text}
        </Text>
        {shouldShowExpand && (
          <TouchableOpacity
            onPress={handleExpandPress}
            hitSlop={8}
            style={styles.expandButton}
          >
            <Text style={styles.expandButtonText}>{isExpanded ? 'Show less' : 'Expand'}</Text>
          </TouchableOpacity>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Little AI</Text>
            <Text style={styles.subtitle}>Local speech capture</Text>
          </View>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() =>
              setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
            }
          >
            <Text style={styles.sortButtonText}>
              {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.controlCard}>
          <View style={styles.countRow}>
            <Text style={styles.countLabel}>Transcriptions</Text>
            <Text style={styles.countValue}>{transcripts.length}</Text>
          </View>

          {isDownloadingModel && (
            <View style={styles.downloadRow}>
              <Text style={styles.downloadText}>
                Downloading model… {modelDownloadProgress ? Math.round(modelDownloadProgress * 100) : 0}%
              </Text>
              <ActivityIndicator size="small" color="#007AFF" />
            </View>
          )}

          {isReady && !isDownloadingModel && (
            <Text style={styles.readyText}>Ready to record</Text>
          )}

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

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
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.recordButtonText}>
                {isRecording ? 'Stop recording' : 'Start recording'}
              </Text>
            )}
          </TouchableOpacity>

          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording…</Text>
            </View>
          )}
        </View>

        <View style={styles.listContainer}>
          {sections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No transcripts yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap “Start recording” to capture the first note.
              </Text>
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              renderItem={renderTranscriptItem}
              stickySectionHeadersEnabled
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                </View>
              )}
              contentContainerStyle={styles.sectionContent}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 2,
  },
  sortButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 20,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  controlCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 3,
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  countLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  countValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
  },
  downloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  downloadText: {
    fontSize: 14,
    color: '#374151',
  },
  readyText: {
    fontSize: 14,
    color: '#059669',
    marginBottom: 12,
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
  },
  recordButton: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  recordButtonActive: {
    backgroundColor: '#DC2626',
  },
  recordButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },
  recordingText: {
    color: '#DC2626',
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  sectionHeader: {
    backgroundColor: '#F4F5F7',
    paddingVertical: 6,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionContent: {
    paddingBottom: 40,
  },
  transcriptCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transcriptCardPressed: {
    opacity: 0.8,
  },
  transcriptCardCopied: {
    borderColor: '#2563EB',
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transcriptTime: {
    fontSize: 13,
    color: '#6B7280',
  },
  copiedLabel: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
  expandButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#EEF2FF',
  },
  expandButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4338CA',
  },
});

