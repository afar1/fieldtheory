import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Alert,
  Pressable,
  Vibration,
  AppState,
  TextInput,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useWhisperRecording } from './hooks/useWhisperRecording';
import { useScopedAppData } from './hooks/useScopedAppData';
import { useSyncCoordinator } from './hooks/useSyncCoordinator';
import { useState, useEffect, useCallback, useMemo, useRef, Component, ErrorInfo, ReactNode } from 'react';
import PagerView from 'react-native-pager-view';
import { TodoList } from './components/TodoList';
import { PullToCreate } from './components/PullToCreate';
import { TranscriptItem } from './components/TranscriptItem';
import { CommandsList } from './components/CommandsList';
import { LibraryView } from './components/LibraryView';
import { StorageService } from './services/storage';
import {
  pauseReadback,
  resumeReadback,
  speakReadback,
  SpeechPlaybackState,
  stopReadback,
  subscribeToSpeechPlaybackState,
} from './services/speech';
import { processTranscription } from './services/llm';
import {
  Todo,
  Observation,
  Settings,
  TranscriptEntry,
  TranscriptSegment,
  LibraryDocument,
} from './types';
import { requestOtp, verifyOtp, getSession, signOut as supabaseSignOut } from './services/auth';
import { sourcePathForLibraryDocument } from './services/sync';
import { deleteLibraryDocument, mergeLibraryDocument } from './services/libraryState';
import { CommandsService } from './services/commands';
import {
  CapturedTranscript,
  createCapturedTranscriptEntry,
  patchTranscriptEntryText,
} from './services/transcriptCapture';
import { useIsDark, useThemeColors } from './services/theme';

// Error boundary component to catch and display errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorBoundaryContainer}>
          <Text style={styles.errorBoundaryTitle}>Something went wrong</Text>
          <Text style={styles.errorBoundaryText}>
            {this.state.error?.message || 'Unknown error'}
          </Text>
          <TouchableOpacity
            style={styles.errorBoundaryButton}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.errorBoundaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

// Top-fade overlay opacities — stripes from fully opaque (top) to nearly
// transparent (bottom) so list items dissolve into the page background.
const TOP_FADE_OPACITIES = [1, 0.85, 0.65, 0.45, 0.25, 0.1];

const TAB_INACTIVE = '#9CA3AF';
const TAB_ACTIVE = '#007AFF';
const LIBRARY_PAGE_INDEX = 0;
const ITEMS_PAGE_INDEX = 1;

// Linear color interpolation between two #rrggbb hex strings.
function lerpHex(from: string, to: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * clamp);
  const g = Math.round(ag + (bg - ag) * clamp);
  const bl = Math.round(ab + (bb - ab) * clamp);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

const MAX_PREVIEW_CHARS = 160; // Max chars to show before truncation
const MAX_PREVIEW_LINES = 3; // Max lines to show before truncation
const ENDING_WORD_COUNT = 4; // Number of words to show from the end
const dateHeaderFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
});

/**
 * Truncate text to show beginning and ending (like crypto addresses).
 * Shows first ~160 chars + "..." + last 4 words.
 * This helps users verify they captured the full transcription.
 */
const truncateWithEnding = (text: string): { preview: string; needsTruncation: boolean } => {
  const words = text.split(/\s+/);
  
  // If text is short enough, no truncation needed
  if (text.length <= MAX_PREVIEW_CHARS + 50) {
    return { preview: text, needsTruncation: false };
  }
  
  // Get the first portion (up to MAX_PREVIEW_CHARS, but try to end at a word boundary)
  let firstPart = text.slice(0, MAX_PREVIEW_CHARS);
  const lastSpaceInFirst = firstPart.lastIndexOf(' ');
  if (lastSpaceInFirst > MAX_PREVIEW_CHARS * 0.7) {
    firstPart = firstPart.slice(0, lastSpaceInFirst);
  }
  
  // Get the last few words
  const lastWords = words.slice(-ENDING_WORD_COUNT).join(' ');
  
  // Make sure we're not showing duplicate content (if text is just barely over the limit)
  if (firstPart.includes(lastWords)) {
    return { preview: text, needsTruncation: false };
  }
  
  return {
    preview: `${firstPart.trim()} ... ${lastWords}`,
    needsTruncation: true,
  };
};

const getDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const formatDateHeader = (timestamp: number) => dateHeaderFormatter.format(new Date(timestamp));
const formatTime = (timestamp: number) => timeFormatter.format(new Date(timestamp));

const STACK_SEPARATOR = '\n\n';

const createSegmentFromEntry = (entry: TranscriptEntry): TranscriptSegment => ({
  id: entry.id,
  text: entry.text,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

const getSegmentsForEntry = (entry: TranscriptEntry): TranscriptSegment[] =>
  entry.stackSegments?.map((segment) => ({
    ...segment,
    updatedAt: segment.updatedAt ?? segment.createdAt,
  })) ?? [createSegmentFromEntry(entry)];

const buildStackText = (segments: TranscriptSegment[]) =>
  segments.map((segment) => segment.text).join(STACK_SEPARATOR);

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const {
    isRecording,
    isProcessing,
    transcription,
    error,
    modelDownloadProgress,
    startRecording,
    stopRecording,
    isReady,
  } = useWhisperRecording();

  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const isDark = useIsDark();

  const {
    todos,
    setTodos,
    observations,
    setObservations,
    settings,
    setSettings,
    transcripts,
    setTranscripts,
    libraryDocuments,
    setLibraryDocuments,
    isInitialized,
    isLibraryHydrated,
    session,
    syncedAt,
    setSyncedAt,
    librarySyncedAt,
    setLibrarySyncedAt,
    callsign,
    authNotice,
    setAuthNotice,
    syncNotice,
    setSyncNotice,
    queueSyncDeletes,
    activateSession,
  } = useScopedAppData();
  const [isProcessingLLM, setIsProcessingLLM] = useState(false);
  const [pageIndex, setPageIndex] = useState(LIBRARY_PAGE_INDEX);
  
  // Transcript history state
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [todosSortOrder, setTodosSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const librarySaveQueueRef = useRef(Promise.resolve());
  const latestQueuedLibraryDocumentsRef = useRef<LibraryDocument[] | null>(null);
  const librarySaveDrainActiveRef = useRef(false);
  const waitForLibrarySaveQueue = useCallback(async () => {
    await librarySaveQueueRef.current.catch(console.error);
  }, []);
  
  // Selection mode state for multi-select stacking and deleting
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Track which specific item is being processed for "Separate Tasks"
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);
  const [speakingTranscriptId, setSpeakingTranscriptId] = useState<string | null>(null);
  const [speechPlaybackState, setSpeechPlaybackState] = useState<SpeechPlaybackState>('stopped');
  
  // Track which items have had tasks separated (so we show "Tasks Saved" instead of button)
  const [separatedIds, setSeparatedIds] = useState<Set<string>>(new Set());
  
  // Track create mode state from PullToCreate - used to show dynamic bottom bar
  const [createMode, setCreateMode] = useState<{
    isCreating: boolean;
    itemType: 'stack' | 'task' | null;
    canSave: boolean;
    save: (() => void) | null;
    cancel: (() => void) | null;
  }>({ isCreating: false, itemType: null, canSave: false, save: null, cancel: null });
  
  // Track keyboard height to position bottom bar above suggestions
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  // Brief flash for Tasks tab when tasks are saved
  const [tasksTabFlash, setTasksTabFlash] = useState(false);

  // Search state for the Items page (transcripts).
  const [itemsSearchVisible, setItemsSearchVisible] = useState(false);
  const [itemsSearchQuery, setItemsSearchQuery] = useState('');

  type PagerRef = React.ComponentRef<typeof PagerView>;
  const pagerRef = useRef<PagerRef>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const {
    isSyncingData,
    isSeeding,
    isLibrarySyncing,
    librarySyncError,
    handleLibrarySyncQuiet,
    handleSyncNow,
    handleSeedNow,
  } = useSyncCoordinator({
    session,
    setTodos,
    setObservations,
    setTranscripts,
    setLibraryDocuments,
    setSyncedAt,
    setLibrarySyncedAt,
    setSyncNotice,
    beforeLibrarySync: waitForLibrarySaveQueue,
  });
  
  // Track last processed transcription to prevent loops/duplicate processing
  const lastProcessedText = useRef<string | null>(null);
  const lastCapturedTranscriptRef = useRef<CapturedTranscript | null>(null);
  // Track if we've auto-started recording on this app session (only once per launch)
  const hasAutoStartedRef = useRef<boolean>(false);
  // Track previous app state to detect foreground transitions
  const appStateRef = useRef<string>(AppState.currentState);
  // Track if user manually stopped recording (prevents auto-start until they manually start again)
  const manuallyStoppedRef = useRef<boolean>(false);

  // Track keyboard height to position bottom bar above suggestions
  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        setKeyboardHeight(event.endCoordinates.height);
      }
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Keep copying feedback timers tidy.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Sync pager to pageIndex state.
  useEffect(() => {
    pagerRef.current?.setPage(pageIndex);
  }, [pageIndex]);

  useEffect(() => {
    const subscription = subscribeToSpeechPlaybackState((state) => {
      setSpeechPlaybackState(state);

      if (state === 'stopped') {
        setSpeakingTranscriptId(null);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, []);

  // Auto-start recording when app returns to foreground (if enabled)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      // Reset auto-start flag when app goes to background, so it can trigger again on next foreground
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        hasAutoStartedRef.current = false;
      }
      
      // Auto-start when transitioning from background/inactive to active (foreground)
      // Only if user hasn't manually stopped recording
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        settings.autoStart &&
        isReady &&
        !isRecording &&
        !isProcessing &&
        !hasAutoStartedRef.current &&
        !manuallyStoppedRef.current
      ) {
        hasAutoStartedRef.current = true;
        startRecording().catch(console.error);
      }
      
      // Sync data when app comes to foreground (if user is authenticated)
      // Runs silently in background, doesn't block UI
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        session
      ) {
        handleLibrarySyncQuiet();
      }
      
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [settings.autoStart, isReady, isRecording, isProcessing, startRecording, session, handleLibrarySyncQuiet]);

  // Capture every finished transcription so we can build the timeline.
  // Saves raw text immediately, then patches in expanded portable commands.
  useEffect(() => {
    if (transcription === null) {
      return;
    }

    const { entry: newEntry, capture } = createCapturedTranscriptEntry(transcription);
    lastCapturedTranscriptRef.current = capture;
    const { sourceText: cleanedText, entryId } = capture;

    setTranscripts((prev) => {
      const updated = [newEntry, ...prev];
      StorageService.saveTranscripts(updated).catch(console.error);
      Clipboard.setStringAsync(cleanedText).catch(console.error);
      return updated;
    });

    const expandAndSave = async () => {
      const { processedText } = await CommandsService.processTranscription(cleanedText);

      if (processedText === cleanedText) {
        return;
      }

      setTranscripts((prev) => {
        const { transcripts: updated, didPatch } = patchTranscriptEntryText(prev, entryId, processedText);
        if (!didPatch) return prev;
        StorageService.saveTranscripts(updated).catch(console.error);
        Clipboard.setStringAsync(processedText).catch(console.error);
        return updated;
      });
    };

    expandAndSave().catch(console.error);
  }, [transcription]);

  const handleProcessTranscription = useCallback(async (text: string) => {
    if (!session) {
      setAuthNotice('Sign in to create tasks and observations.');
      return false;
    }

    // Prevent re-processing the same text (breaks dependency loop)
    if (text === lastProcessedText.current) return false;
    lastProcessedText.current = text;

    setIsProcessingLLM(true);
    try {
      // Get current state at time of processing to avoid stale closures
      const currentTodos = todos;
      const currentObservations = observations;
      
      const diff = await processTranscription(text, currentTodos, currentObservations);

      // Apply diff operations
      let newTodos = [...currentTodos];
      let newObservations = [...currentObservations];

      // Create new todos
      for (const todo of diff.todos.create) {
        const newTodo: Todo = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          text: todo.text,
          completed: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        newTodos.push(newTodo);
      }

      // Update existing todos
      for (const update of diff.todos.update) {
        const index = newTodos.findIndex((t) => t.id === update.id);
        if (index !== -1) {
          newTodos[index] = {
            ...newTodos[index],
            ...(update.text !== undefined && { text: update.text }),
            ...(update.completed !== undefined && { completed: update.completed }),
            updatedAt: Date.now(),
          };
        }
      }

      // Delete todos
      const deletedTodoIds = diff.todos.delete.filter((id) => newTodos.some((todo) => todo.id === id));
      newTodos = newTodos.filter((t) => !diff.todos.delete.includes(t.id));

      // Create new observations
      for (const obs of diff.observations.create) {
        const newObs: Observation = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          text: obs.text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        newObservations.push(newObs);
      }

      // Update state and persist
      setTodos(newTodos);
      setObservations(newObservations);
      await Promise.all([
        StorageService.saveTodos(newTodos),
        StorageService.saveObservations(newObservations),
        queueSyncDeletes('todos', deletedTodoIds),
      ]);
      return true;
    } catch (err) {
      console.error('Failed to process transcription:', err);
      if (lastProcessedText.current === text) {
        lastProcessedText.current = '';
      }
      return false;
    } finally {
      setIsProcessingLLM(false);
    }
  }, [session, todos, observations, queueSyncDeletes]);

  // Process transcription with LLM when it becomes available (only if auto-separate is enabled)
  // Also marks the transcript as separated when done and flashes the Tasks tab
  useEffect(() => {
    if (transcription && transcription.trim().length > 0 && settings.autoSeparate) {
      const capturedEntry = lastCapturedTranscriptRef.current;
      const matchingEntryId = capturedEntry?.sourceText === transcription.trim()
        ? capturedEntry.entryId
        : transcripts.find(t => t.text === transcription.trim())?.id;
      
      handleProcessTranscription(transcription).then((didProcess) => {
        if (didProcess && matchingEntryId) {
          setSeparatedIds((prev) => new Set(prev).add(matchingEntryId));
          setTasksTabFlash(true);
          setTimeout(() => setTasksTabFlash(false), 1500);
        }
      });
    }
  }, [transcription, handleProcessTranscription, settings.autoSeparate, transcripts]);

  const sortedTranscripts = useMemo(() => {
    return [...transcripts].sort((a, b) =>
      sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
    );
  }, [transcripts, sortOrder]);

  const filteredTranscripts = useMemo(() => {
    const q = itemsSearchQuery.trim().toLowerCase();
    if (!q) return sortedTranscripts;
    return sortedTranscripts.filter((entry) => {
      if (entry.text?.toLowerCase().includes(q)) return true;
      if (entry.stackSegments?.some((seg) => seg.text.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [sortedTranscripts, itemsSearchQuery]);

  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      // Incomplete tasks come first, then completed tasks
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // Within each group, sort by date
      return todosSortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });
  }, [todos, todosSortOrder]);

  const todosSections = useMemo(() => {
    const grouped: { key: string; title: string; data: Todo[] }[] = [];
    const sectionIndex: Record<string, number> = {};

    sortedTodos.forEach((todo) => {
      const key = getDateKey(todo.createdAt);

      if (sectionIndex[key] === undefined) {
        sectionIndex[key] = grouped.length;
        grouped.push({
          key,
          title: formatDateHeader(todo.createdAt),
          data: [],
        });
      }

      grouped[sectionIndex[key]].data.push(todo);
    });

    return grouped;
  }, [sortedTodos]);

  const handleRecordPress = async () => {
    if (isRecording) {
      await stopRecording();
      manuallyStoppedRef.current = true; // User manually stopped - don't auto-start again
    } else {
      await startRecording();
      manuallyStoppedRef.current = false; // User manually started - allow auto-start again
    }
  };

  const handleRequestOtp = useCallback(async () => {
    const email = authEmail.trim();

    if (!email) {
      Alert.alert('Email required', 'Enter an email address to receive the OTP.');
      return;
    }

    setIsRequestingOtp(true);
    setAuthNotice(null);

    try {
      await requestOtp(email.toLowerCase());
      setAuthNotice('Check your email for the six-digit code.');
    } catch (err) {
      console.error('Failed to request OTP:', err);
      Alert.alert('OTP error', err instanceof Error ? err.message : 'Unable to send code right now.');
    } finally {
      setIsRequestingOtp(false);
    }
  }, [authEmail]);

  const handleVerifyOtp = useCallback(async () => {
    const email = authEmail.trim();
    const token = otpCode.trim();

    if (!email || !token) {
      Alert.alert('Missing info', 'Provide both your email and the code from your inbox.');
      return;
    }

    setIsVerifyingOtp(true);
    setAuthNotice(null);

    try {
      await verifyOtp(email.toLowerCase(), token);
      const currentSession = await getSession();
      await activateSession(currentSession);
      setAuthNotice('Signed in. You can sync now.');
      setOtpCode('');
    } catch (err) {
      console.error('Failed to verify OTP:', err);
      Alert.alert('Verification failed', err instanceof Error ? err.message : 'Unable to verify the code right now.');
    } finally {
      setIsVerifyingOtp(false);
    }
  }, [activateSession, authEmail, otpCode]);

  const handleSignOutPress = useCallback(async () => {
    try {
      const currentUserId = session?.user.id;
      await CommandsService.clearCache(currentUserId);
      await supabaseSignOut();
      await activateSession(null);
      setSyncNotice(null);
      setAuthNotice('Signed out.');
    } catch (err) {
      console.error('Failed to sign out:', err);
      Alert.alert('Sign out failed', err instanceof Error ? err.message : 'Unable to sign out.');
    }
  }, [activateSession, session?.user.id]);

  const handleToggleComplete = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed, updatedAt: Date.now() } : todo
      );
      StorageService.saveTodos(next).catch(console.error);
      return next;
    });
  }, []);

  const handleUpdateTodo = useCallback((id: string, text: string) => {
    setTodos((prev) => {
      const next = prev.map((todo) => (todo.id === id ? { ...todo, text, updatedAt: Date.now() } : todo));
      StorageService.saveTodos(next).catch(console.error);
      return next;
    });
  }, []);

  const handleDeleteTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.filter((todo) => todo.id !== id);
      queueSyncDeletes('todos', [id]).catch(console.error);
      StorageService.saveTodos(next).catch(console.error);
      return next;
    });
  }, [queueSyncDeletes]);

  // Create a new task via pull-to-create.
  const handleCreateTask = useCallback((text: string): boolean => {
    const newTodo: Todo = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTodos((prev) => {
      const next = [newTodo, ...prev];
      StorageService.saveTodos(next).catch(console.error);
      return next;
    });
    return true;
  }, []);

  // Create a new transcript via pull-to-create.
  const handleCreateTranscript = useCallback((text: string): boolean => {
    const newEntry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTranscripts((prev) => {
      const next = [newEntry, ...prev];
      StorageService.saveTranscripts(next).catch(console.error);
      return next;
    });
    return true;
  }, []);

  // Handle create mode changes from PullToCreate - used to show dynamic bottom bar.
  const handleStackCreateModeChange = useCallback((isCreating: boolean, canSave: boolean, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'stack', canSave, save, cancel });
  }, []);

  const handleTaskCreateModeChange = useCallback((isCreating: boolean, canSave: boolean, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'task', canSave, save, cancel });
  }, []);

  const handleCommandCreateModeChange = useCallback((isCreating: boolean, canSave: boolean, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'task', canSave, save, cancel });
  }, []);

  const handleToggleAutoStart = useCallback((value: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, autoStart: value };
      StorageService.saveSettings(next).catch(console.error);
      return next;
    });
  }, []);

  const handleToggleSetting = useCallback((key: keyof Settings, value: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      StorageService.saveSettings(next).catch(console.error);
      return next;
    });
  }, []);

  const queueLibraryDocumentsSave = useCallback((documents: LibraryDocument[]) => {
    latestQueuedLibraryDocumentsRef.current = documents;
    if (librarySaveDrainActiveRef.current) return;

    librarySaveDrainActiveRef.current = true;
    librarySaveQueueRef.current = librarySaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        while (latestQueuedLibraryDocumentsRef.current) {
          const nextDocuments = latestQueuedLibraryDocumentsRef.current;
          latestQueuedLibraryDocumentsRef.current = null;
          await StorageService.saveLibraryDocuments(nextDocuments);
        }
      })
      .finally(() => {
        librarySaveDrainActiveRef.current = false;
      });
    librarySaveQueueRef.current.catch(console.error);
  }, []);

  const handleLibraryDocumentsChange = useCallback((documents: LibraryDocument[]) => {
    setLibraryDocuments((previous) => {
      const nextIds = new Set(documents.map((doc) => doc.id));
      const deletedDocuments = previous.filter((doc) => !nextIds.has(doc.id));
      if (deletedDocuments.length > 0) {
        const deletedAt = Date.now();
        StorageService.addLibraryTombstones(deletedDocuments.map((doc) => ({
          id: doc.id,
          sourcePath: sourcePathForLibraryDocument(doc),
          createdAt: doc.createdAt,
          deletedAt,
        }))).catch(console.error);
      }
      return documents;
    });
    queueLibraryDocumentsSave(documents);
  }, [queueLibraryDocumentsSave]);

  const handleLibraryDocumentChange = useCallback((document: LibraryDocument) => {
    setLibraryDocuments((previous) => {
      const next = mergeLibraryDocument(previous, document);
      queueLibraryDocumentsSave(next);
      return next;
    });
  }, [queueLibraryDocumentsSave]);

  const handleLibraryDocumentDelete = useCallback((document: LibraryDocument) => {
    setLibraryDocuments((previous) => {
      const next = deleteLibraryDocument(previous, document.id);
      StorageService.addLibraryTombstones([{
        id: document.id,
        sourcePath: sourcePathForLibraryDocument(document),
        createdAt: document.createdAt,
        deletedAt: Date.now(),
      }]).catch(console.error);
      queueLibraryDocumentsSave(next);
      return next;
    });
  }, [queueLibraryDocumentsSave]);

  const handleLibrarySyncPress = useCallback(async (flushedDocuments?: LibraryDocument[]) => {
    if (flushedDocuments) {
      queueLibraryDocumentsSave(flushedDocuments);
    }
    await handleLibrarySyncQuiet();
  }, [handleLibrarySyncQuiet, queueLibraryDocumentsSave]);

  const handleCopyTranscript = useCallback(async (entry: TranscriptEntry) => {
    await Clipboard.setStringAsync(entry.text);
    Vibration.vibrate();
    setCopiedId(entry.id);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  const handleDeleteTranscript = useCallback((id: string) => {
    setTranscripts((prev) => {
      const updated = prev.filter((entry) => entry.id !== id);
      // Save to storage when deleting
      queueSyncDeletes('transcripts', [id]).catch(console.error);
      StorageService.saveTranscripts(updated).catch(console.error);
      return updated;
    });
    setExpandedMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [queueSyncDeletes]);

  // Transcript editing state
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editTranscriptText, setEditTranscriptText] = useState('');

  const handleUpdateTranscript = useCallback((id: string, text: string) => {
    setTranscripts((prev) => {
      const updated = prev.map((transcript) =>
        transcript.id === id ? { ...transcript, text: text.trim(), updatedAt: Date.now() } : transcript
      );
      StorageService.saveTranscripts(updated).catch(console.error);
      return updated;
    });
    setEditingTranscriptId(null);
    setEditTranscriptText('');
  }, []);

  const handleEditTranscript = useCallback((transcript: TranscriptEntry) => {
    setEditingTranscriptId(transcript.id);
    setEditTranscriptText(transcript.text);
  }, []);

  const handleCancelEditTranscript = useCallback(() => {
    setEditingTranscriptId(null);
    setEditTranscriptText('');
  }, []);

  const handleSpeakTranscript = useCallback(async (entry: TranscriptEntry) => {
    if (speakingTranscriptId === entry.id) {
      if (speechPlaybackState === 'speaking') {
        pauseReadback();
        return;
      }

      if (speechPlaybackState === 'paused') {
        resumeReadback();
        return;
      }
    }

    const spoke = await speakReadback(entry.text);
    if (!spoke) {
      setSpeakingTranscriptId(null);
      setSpeechPlaybackState('stopped');
      Alert.alert('Voice unavailable', 'Unable to speak this stack right now.');
      return;
    }

    setSpeakingTranscriptId(entry.id);
    setSpeechPlaybackState('speaking');
  }, [speakingTranscriptId, speechPlaybackState]);

  useEffect(() => {
    return () => {
      stopReadback();
    };
  }, []);

  // Manually separate a transcript into tasks and observations.
  // This is used when auto-separate is disabled.
  const handleManualSeparate = useCallback(async (text: string, itemId: string) => {
    if (isProcessingLLM) return; // Don't allow multiple separations at once
    
    Vibration.vibrate();
    setProcessingItemId(itemId);
    const didProcess = await handleProcessTranscription(text);
    setProcessingItemId(null);
    if (!didProcess) return;
    
    // Mark this item as separated and flash the Tasks tab
    setSeparatedIds((prev) => new Set(prev).add(itemId));
    setTasksTabFlash(true);
    setTimeout(() => setTasksTabFlash(false), 1500);
  }, [isProcessingLLM, handleProcessTranscription]);

  // Merge two transcripts together to create a stack.
  const stackTranscripts = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      return;
    }

    setTranscripts((prev) => {
      const sourceEntry = prev.find((entry) => entry.id === sourceId);
      const targetEntry = prev.find((entry) => entry.id === targetId);

      if (!sourceEntry || !targetEntry) {
        return prev;
      }

      const sourceSegments = getSegmentsForEntry(sourceEntry);
      const targetSegments = getSegmentsForEntry(targetEntry);
      // Combine both sides and order them chronologically so the stack reads naturally.
      const mergedSegments = [...targetSegments, ...sourceSegments].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      // Use the latest time from all segments as the stack's createdAt.
      const latestTime = Math.max(...mergedSegments.map((s) => s.createdAt));
      const updatedTarget: TranscriptEntry = {
        ...targetEntry,
        text: buildStackText(mergedSegments),
        stackSegments: mergedSegments,
        createdAt: latestTime,
        updatedAt: Date.now(),
      };
      const updatedList = prev
        .filter((entry) => entry.id !== sourceId)
        .map((entry) => (entry.id === targetId ? updatedTarget : entry));

      queueSyncDeletes('transcripts', [sourceId]).catch(console.error);
      StorageService.saveTranscripts(updatedList).catch(console.error);

      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        delete next[sourceId];
        // Keep stacked items collapsed by default for easier navigation.
        delete next[targetId];
        return next;
      });

      setCopiedId((prevCopied) => (prevCopied === sourceId ? null : prevCopied));

      return updatedList;
    });
  }, [queueSyncDeletes, setExpandedMap, setCopiedId]);

  // Restore every segment back into standalone transcripts if the user made a mistake.
  const handleUnstackTranscript = useCallback((id: string) => {
    setTranscripts((prev) => {
      const entry = prev.find((item) => item.id === id);
      if (!entry?.stackSegments || entry.stackSegments.length <= 1) {
        return prev;
      }

      const restoredEntries: TranscriptEntry[] = entry.stackSegments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        createdAt: segment.createdAt,
        updatedAt: segment.updatedAt ?? segment.createdAt,
      }));

      const withoutParent = prev.filter((item) => item.id !== id);
      const updatedList = [...withoutParent, ...restoredEntries];

      queueSyncDeletes('transcripts', [id]).catch(console.error);
      StorageService.saveTranscripts(updatedList).catch(console.error);

      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        delete next[id];
        return next;
      });

      return updatedList;
    });
  }, [queueSyncDeletes, setExpandedMap]);

  // Enter selection mode when long-pressing a card.
  const enterSelectionMode = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  // Toggle selection of a single item.
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Exit selection mode and clear selection.
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Delete all selected stacks with confirmation.
  // Stays in selection mode so user can continue deleting more items.
  const handleDeleteSelected = useCallback(() => {
    const count = selectedIds.size;
    Alert.alert(
      `Delete ${count} stack${count > 1 ? 's' : ''}?`,
      'This removes the selected stacks from your device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setTranscripts((prev) => {
              const updated = prev.filter((entry) => !selectedIds.has(entry.id));
              queueSyncDeletes('transcripts', Array.from(selectedIds)).catch(console.error);
              StorageService.saveTranscripts(updated).catch(console.error);
              return updated;
            });
            setExpandedMap((prev) => {
              const next = { ...prev };
              selectedIds.forEach((id) => delete next[id]);
              return next;
            });
            // Clear selection but stay in selection mode
            setSelectedIds(new Set());
          },
        },
      ]
    );
  }, [queueSyncDeletes, selectedIds]);

  // Stack all selected transcripts. Uses the first selected as the target, merges others into it.
  const handleStackSelected = useCallback(() => {
    if (selectedIds.size < 2) return;

    // Get all selected entries in their current order.
    const selectedEntries = sortedTranscripts.filter((entry) => selectedIds.has(entry.id));
    if (selectedEntries.length < 2) return;

    // Use the first selected as the target, stack all others onto it.
    const [targetEntry, ...sourceEntries] = selectedEntries;

    setTranscripts((prev) => {
      // Gather all segments from target and sources.
      let allSegments = getSegmentsForEntry(targetEntry);
      for (const source of sourceEntries) {
        allSegments = [...allSegments, ...getSegmentsForEntry(source)];
      }
      // Sort chronologically.
      allSegments.sort((a, b) => a.createdAt - b.createdAt);

      // Use the latest time from all segments.
      const latestTime = Math.max(...allSegments.map((s) => s.createdAt));
      const updatedTarget: TranscriptEntry = {
        ...targetEntry,
        text: buildStackText(allSegments),
        stackSegments: allSegments,
        createdAt: latestTime,
        updatedAt: Date.now(),
      };

      // Remove source entries from the list.
      const sourceIds = new Set(sourceEntries.map((e) => e.id));
      const updatedList = prev
        .filter((entry) => !sourceIds.has(entry.id))
        .map((entry) => (entry.id === targetEntry.id ? updatedTarget : entry));

      queueSyncDeletes('transcripts', Array.from(sourceIds)).catch(console.error);
      StorageService.saveTranscripts(updatedList).catch(console.error);

      // Keep stacked items collapsed by default for easier navigation.
      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        sourceIds.forEach((id) => delete next[id]);
        delete next[targetEntry.id];
        return next;
      });

      return updatedList;
    });

    exitSelectionMode();
  }, [queueSyncDeletes, selectedIds, sortedTranscripts, exitSelectionMode]);

  // Check if any selected item is stacked (for enabling Unstack button)
  const hasSelectedStacked = useMemo(() => {
    return sortedTranscripts.some(
      (entry) => selectedIds.has(entry.id) && (entry.stackSegments?.length ?? 1) > 1
    );
  }, [selectedIds, sortedTranscripts]);


  // Unstack all selected stacked items
  const handleUnstackSelected = useCallback(() => {
    const stackedIds = sortedTranscripts
      .filter((entry) => selectedIds.has(entry.id) && (entry.stackSegments?.length ?? 1) > 1)
      .map((entry) => entry.id);
    
    stackedIds.forEach((id) => handleUnstackTranscript(id));
    setSelectedIds(new Set());
  }, [selectedIds, sortedTranscripts, handleUnstackTranscript]);

  // Render a single transcript item using memoized component.
  // We compute per-item state here and pass it as props to avoid re-rendering the whole list.
  const renderTranscriptItem = useCallback(({ item, index }: { item: TranscriptEntry; index: number }) => {
    const prevItem = index > 0 ? filteredTranscripts[index - 1] : null;
    const showDateHeader = !prevItem || getDateKey(item.createdAt) !== getDateKey(prevItem.createdAt);

    return (
      <TranscriptItem
        item={item}
        isExpanded={Boolean(expandedMap[item.id])}
        isCopied={copiedId === item.id}
        isSelected={selectedIds.has(item.id)}
        isProcessingThis={processingItemId === item.id}
        isSeparated={separatedIds.has(item.id)}
        isSpeaking={speakingTranscriptId === item.id && speechPlaybackState === 'speaking'}
        isPaused={speakingTranscriptId === item.id && speechPlaybackState === 'paused'}
        showDateHeader={showDateHeader}
        selectionMode={selectionMode}
        isProcessingLLM={isProcessingLLM}
        autoSeparate={settings.autoSeparate}
        isEditing={editingTranscriptId === item.id}
        editText={editingTranscriptId === item.id ? editTranscriptText : ''}
        onEditTextChange={setEditTranscriptText}
        onToggleExpand={handleToggleExpand}
        onSpeak={handleSpeakTranscript}
        onManualSeparate={handleManualSeparate}
        onUnstack={handleUnstackTranscript}
        onCopy={handleCopyTranscript}
        onEnterSelectionMode={enterSelectionMode}
        onToggleSelection={toggleSelection}
        onEdit={handleEditTranscript}
        onCancelEdit={handleCancelEditTranscript}
        onSaveEdit={handleUpdateTranscript}
      />
    );
  }, [
    filteredTranscripts,
    expandedMap,
    copiedId,
    selectedIds,
    processingItemId,
    separatedIds,
    speakingTranscriptId,
    speechPlaybackState,
    selectionMode,
    isProcessingLLM,
    settings.autoSeparate,
    editingTranscriptId,
    editTranscriptText,
    handleToggleExpand,
    handleSpeakTranscript,
    handleManualSeparate,
    handleUnstackTranscript,
    handleCopyTranscript,
    enterSelectionMode,
    toggleSelection,
    handleEditTranscript,
    handleCancelEditTranscript,
    handleUpdateTranscript,
  ]);

  // Per-page proximity (1 = active page, 0 = other page).
  // Defined before any early-return so all hooks below stay in stable order.
  const proximityToPage = (idx: number) => (pageIndex === idx ? 1 : 0);
  // Keep Items mounted; PagerView can show a blank newly-mounted page until
  // the next state change forces layout on device.
  const shouldRenderPage = (idx: number) => idx === ITEMS_PAGE_INDEX || Math.abs(pageIndex - idx) <= 1;

  // Tab tap navigation. The pager owns the native transition; React only tracks
  // the selected page instead of re-rendering the whole tree during scroll.
  const navigateToPage = (idx: number) => {
    setPageIndex(idx);
  };
  const hideBottomBar = pageIndex === LIBRARY_PAGE_INDEX || (!createMode.isCreating && !selectionMode && keyboardHeight > 0);

  // Items page search row — rendered as the FlatList header so it scrolls
  // with the list (not sticky) and only takes up the height it needs.
  // Memoized so its identity stays stable across unrelated re-renders;
  // otherwise FlatList would treat each render as a new header and churn.
  const itemsSearchOpacity = proximityToPage(ITEMS_PAGE_INDEX);
  const itemsSearchHeader = useMemo(
    () => (
      <View style={[styles.searchHeader, { opacity: itemsSearchOpacity, backgroundColor: colors.bgPage }]}>
        {itemsSearchVisible ? (
          <View style={[styles.searchInputRow, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              value={itemsSearchQuery}
              onChangeText={setItemsSearchQuery}
              placeholder="Search items"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="search"
            />
            <TouchableOpacity
              onPress={() => {
                setItemsSearchQuery('');
                setItemsSearchVisible(false);
                Keyboard.dismiss();
              }}
              hitSlop={8}
            >
              <Feather name="x" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.searchIconButton}
            onPress={() => setItemsSearchVisible(true)}
            hitSlop={8}
          >
            <Feather name="search" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    ),
    [itemsSearchVisible, itemsSearchQuery, itemsSearchOpacity, colors],
  );

  // Show loading state during initial data load.
  // Must come AFTER all hooks so hook order is stable across renders.
  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.bgPage }]}>
          <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header removed - moved settings to bottom tab */}

      {/* Recording Indicator - Orange dot with pulsing animation when recording. */}
      {/* Shows at top of screen so it's visible on all tabs, even in background. */}
      {isRecording && (
        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording...</Text>
        </View>
      )}

      {/* Error display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isReady && modelDownloadProgress !== null && !error && (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.processingText}>
            Downloading speech model {Math.round(modelDownloadProgress * 100)}%
          </Text>
        </View>
      )}

      {/* Processing indicator - only for transcription */}
      {isProcessing && (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.processingText}>Transcribing...</Text>
        </View>
      )}

      {/* Pager View - Order: Library → Items → Commands → Tasks → Settings */}
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={LIBRARY_PAGE_INDEX}
        scrollEnabled={true}
        overdrag={false}
        overScrollMode="never"
        onPageSelected={(e) => {
          try {
            setPageIndex(e.nativeEvent.position);
          } catch (err) {
            console.error('Error handling page selection:', err);
          }
        }}
      >
        <View key="library" style={[styles.pageContainer, { backgroundColor: colors.bgPage }]}>
          {shouldRenderPage(0) ? (
            <LibraryView
              documents={libraryDocuments}
              onChange={handleLibraryDocumentsChange}
              onDocumentChange={handleLibraryDocumentChange}
              onDocumentDelete={handleLibraryDocumentDelete}
              callsign={callsign}
              lastSyncedAt={librarySyncedAt}
              isSyncing={isLibrarySyncing}
              syncError={librarySyncError}
              isHydrating={!isLibraryHydrated}
              onSyncPress={handleLibrarySyncPress}
              storageScopeId={session?.user.id ?? 'local'}
            />
          ) : null}
        </View>
        <View key="transcripts" style={[styles.transcriptContainer, { backgroundColor: colors.bgPage }]}>
          {shouldRenderPage(1) ? (
            <View style={styles.transcriptListWrapper}>
              {/* Top fade overlay — items gently fade as they scroll past the top. */}
              <View pointerEvents="none" style={styles.topFadeOverlay}>
                {TOP_FADE_OPACITIES.map((op, i) => (
                  <View
                    key={i}
                    style={{ height: 4, backgroundColor: colors.bgPage, opacity: op }}
                  />
                ))}
              </View>
              <PullToCreate
                itemType="transcript"
                onCreateItem={handleCreateTranscript}
                enabled={true}
                style={{ flex: 1 }}
                onCreateModeChange={handleStackCreateModeChange}
              >
                {filteredTranscripts.length === 0 ? (
                  <FlatList
                    data={[]}
                    renderItem={() => null}
                    ListHeaderComponent={itemsSearchHeader}
                    ListEmptyComponent={
                      <View style={styles.emptyState}>
                        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                          {itemsSearchQuery ? 'No matches' : 'No stacks yet'}
                        </Text>
                        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                          {itemsSearchQuery
                            ? 'Try a different search term.'
                            : 'Pull down to type a note, or tap Record.'}
                        </Text>
                      </View>
                    }
                    contentContainerStyle={{ flex: 1 }}
                  />
                ) : (
                  <FlatList
                    data={filteredTranscripts}
                    keyExtractor={(item) => item.id}
                    renderItem={renderTranscriptItem}
                    ListHeaderComponent={itemsSearchHeader}
                    contentContainerStyle={styles.sectionContent}
                    windowSize={5}
                    removeClippedSubviews={true}
                    maxToRenderPerBatch={10}
                    initialNumToRender={10}
                  />
                )}
              </PullToCreate>
            </View>
          ) : null}
        </View>
        <View key="commands" style={[styles.pageContainer, { backgroundColor: colors.bgPage }]}>
          {shouldRenderPage(2) ? (
            <CommandsList
              userId={session?.user.id ?? null}
              searchOpacity={proximityToPage(2)}
              isActive={pageIndex === 2}
              onCreateModeChange={handleCommandCreateModeChange}
            />
          ) : null}
        </View>
        <View key="todos" style={[styles.pageContainer, { backgroundColor: colors.bgPage }]}>
          {shouldRenderPage(3) ? (
            <TodoList
              sections={todosSections}
              onToggleComplete={handleToggleComplete}
              onUpdate={handleUpdateTodo}
              onDelete={handleDeleteTodo}
              formatTime={formatTime}
              formatDateHeader={formatDateHeader}
              onCreateTask={handleCreateTask}
              onCreateModeChange={handleTaskCreateModeChange}
              searchOpacity={proximityToPage(3)}
            />
          ) : null}
        </View>
        <View key="settings" style={[styles.pageContainer, { backgroundColor: colors.bgPage }]}>
          {shouldRenderPage(4) ? (
            <ScrollView
              style={[styles.settingsPageScroll, { backgroundColor: colors.bgPage }]}
              contentContainerStyle={styles.settingsPageContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Settings</Text>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>Start recording on app open</Text>
              <Switch
                value={settings.autoStart}
                onValueChange={handleToggleAutoStart}
                trackColor={{ false: '#d1d5db', true: '#14372A' }}
              />
            </View>

            <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>Show Features</Text>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>Tasks tab</Text>
              <Switch
                value={settings.showTodos}
                onValueChange={(value) => handleToggleSetting('showTodos', value)}
                trackColor={{ false: '#d1d5db', true: '#14372A' }}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>Library tab</Text>
              <Switch
                value={settings.showLibrary}
                onValueChange={(value) => handleToggleSetting('showLibrary', value)}
                trackColor={{ false: '#d1d5db', true: '#14372A' }}
              />
            </View>

            <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>Transcript Processing</Text>

            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>Auto Create Tasks and Observations</Text>
                <Text style={[styles.settingDescription, { color: colors.textSecondary }]}>
                  {settings.autoSeparate
                    ? 'Fields are automatically processed'
                    : 'Use the Create Tasks button on each stack'}
                </Text>
              </View>
              <Switch
                value={settings.autoSeparate}
                onValueChange={(value) => handleToggleSetting('autoSeparate', value)}
                trackColor={{ false: '#d1d5db', true: '#14372A' }}
              />
            </View>

            <View style={styles.syncSection}>
              <Text style={[styles.sectionHeading, { color: colors.textPrimary }]}>Supabase Sync</Text>
              <Text style={[styles.syncStatusText, { color: colors.textSecondary }]}>
                {session ? `Signed in as ${session.user.email === 'andrew.mfarah@gmail.com' ? 'A. Farah' : session.user.email}` : 'Not signed in'}
              </Text>

              <TextInput
                style={styles.fieldInput}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={authEmail}
                onChangeText={setAuthEmail}
              />

              {!session && (
                <>
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      isRequestingOtp && styles.buttonDisabled,
                    ]}
                    onPress={handleRequestOtp}
                    disabled={isRequestingOtp}
                  >
                    <Text style={styles.actionButtonText}>
                      {isRequestingOtp ? 'Sending code...' : 'Send Code'}
                    </Text>
                  </TouchableOpacity>

                  <TextInput
                    style={styles.fieldInput}
                    placeholder="Enter code"
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    value={otpCode}
                    onChangeText={setOtpCode}
                  />

                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      isVerifyingOtp && styles.buttonDisabled,
                    ]}
                    onPress={handleVerifyOtp}
                    disabled={isVerifyingOtp}
                  >
                    <Text style={styles.actionButtonText}>
                      {isVerifyingOtp ? 'Verifying...' : 'Verify Code'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {session && (
                <>
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      (isSyncingData || isSeeding) && styles.buttonDisabled,
                    ]}
                    onPress={handleSyncNow}
                    disabled={isSyncingData || isSeeding}
                  >
                    <Text style={styles.actionButtonText}>
                      {isSyncingData ? 'Syncing...' : 'Sync Now'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      isSeeding && styles.buttonDisabled,
                    ]}
                    onPress={handleSeedNow}
                    disabled={isSeeding}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {isSeeding ? 'Seeding...' : 'Seed Current Data'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleSignOutPress}
                  >
                    <Text style={styles.secondaryButtonText}>Sign Out</Text>
                  </TouchableOpacity>
                </>
              )}

              {syncedAt && (
                <Text style={[styles.syncStatusText, { color: colors.textSecondary }]}>
                  Last synced at {formatTime(syncedAt)}
                </Text>
              )}
              {syncNotice && <Text style={[styles.syncStatusText, { color: colors.textSecondary }]}>{syncNotice}</Text>}
              {authNotice && <Text style={[styles.syncStatusText, { color: colors.textSecondary }]}>{authNotice}</Text>}
            </View>
            </ScrollView>
          ) : null}
        </View>
        </PagerView>

      {/* BOTTOM BAR - Changes based on mode (create > selection > normal).
          Hidden on Library so reading and writing get the full screen. Also
          hidden when the keyboard is up in plain typing (e.g. search). */}
      {hideBottomBar ? null : (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={createMode.isCreating && Platform.OS === 'ios' ? 36 : 0} // 36px offset for iOS suggestion bar when creating
      >
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom, backgroundColor: colors.bgElevated, borderTopColor: colors.border }]}>
          {createMode.isCreating ? (
            /* Create mode: Cancel | Save */
            <>
              <TouchableOpacity
                onPress={() => createMode.cancel?.()}
                style={styles.tabButton}
              >
                <Feather name="x" size={22} color="#6B7280" />
                <Text style={styles.tabLabel}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={() => createMode.save?.()}
                style={[styles.saveTabButton, !createMode.canSave && styles.saveTabButtonDisabled]}
                disabled={!createMode.canSave}
              >
                <Feather 
                  name="check" 
                  size={22} 
                  color={createMode.canSave ? '#fff' : '#9CA3AF'}
                />
                <Text style={[styles.saveTabButtonText, !createMode.canSave && styles.saveTabButtonTextDisabled]}>
                  Save Item
                </Text>
              </TouchableOpacity>
            </>
          ) : selectionMode ? (
          /* Selection mode: Back | Stack | Unstack | Delete */
          <>
            <TouchableOpacity
              onPress={exitSelectionMode}
              style={styles.tabButton}
            >
              <Feather name="arrow-left" size={22} color="#6B7280" />
              <Text style={styles.tabLabel}>Back</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleStackSelected}
              style={[styles.tabButton, selectedIds.size < 2 && styles.selectionBottomButtonDisabled]}
              disabled={selectedIds.size < 2}
            >
              <Feather name="layers" size={22} color={selectedIds.size >= 2 ? '#2563EB' : '#9CA3AF'} />
              <Text style={[styles.tabLabel, selectedIds.size >= 2 ? styles.stackTabLabel : styles.tabLabelDisabled]}>
                Stack
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleUnstackSelected}
              style={[styles.tabButton, !hasSelectedStacked && styles.selectionBottomButtonDisabled]}
              disabled={!hasSelectedStacked}
            >
              <Feather name="minimize-2" size={22} color={hasSelectedStacked ? '#7C3AED' : '#9CA3AF'} />
              <Text style={[styles.tabLabel, hasSelectedStacked ? styles.unstackTabLabel : styles.tabLabelDisabled]}>
                Unstack
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => {
                // Edit only works with exactly 1 item selected
                if (selectedIds.size === 1) {
                  const selectedId = Array.from(selectedIds)[0];
                  const entry = sortedTranscripts.find(t => t.id === selectedId);
                  if (entry) {
                    handleEditTranscript(entry);
                    exitSelectionMode();
                  }
                }
              }}
              style={[styles.tabButton, selectedIds.size !== 1 && styles.selectionBottomButtonDisabled]}
              disabled={selectedIds.size !== 1}
            >
              <Feather name="edit-2" size={22} color={selectedIds.size === 1 ? '#059669' : '#9CA3AF'} />
              <Text style={[styles.tabLabel, selectedIds.size === 1 ? styles.editTabLabel : styles.tabLabelDisabled]}>
                Edit
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleDeleteSelected}
              style={[styles.tabButton, selectedIds.size === 0 && styles.selectionBottomButtonDisabled]}
              disabled={selectedIds.size === 0}
            >
              <Feather name="trash-2" size={22} color={selectedIds.size > 0 ? '#DC2626' : '#9CA3AF'} />
              <Text style={[styles.tabLabel, selectedIds.size > 0 ? styles.deleteTabLabel : styles.tabLabelDisabled]}>
                Delete
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          /* Normal mode: show tab navigation
           * Layout: Library, Items, [RECORD], Commands, Tasks, Settings
           * Library stays left of Items while Record remains near center.
           */
          <>
            {settings.showLibrary && (
              <TouchableOpacity
                style={styles.tabButton}
                onPress={() => navigateToPage(0)}
              >
                <Feather
                  name="book-open"
                  size={22}
                  color={lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(0))}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(0)) },
                  ]}
                >
                  Library
                </Text>
              </TouchableOpacity>
            )}

            {/* Items Tab (was iOS Fields / Stacks) */}
            <TouchableOpacity
              style={styles.tabButton}
              onPress={() => navigateToPage(1)}
            >
              <Feather
                name="layers"
                size={22}
                color={lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(1))}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(1)) },
                ]}
              >
                Items
              </Text>
            </TouchableOpacity>

            {/* RECORD BUTTON - Floating Center */}
            <View style={styles.recordButtonContainer}>
              <TouchableOpacity
                style={[
                  styles.recordButton,
                  isRecording && styles.recordButtonActive,
                  (!isReady || isProcessing || isProcessingLLM) && styles.recordButtonDisabled,
                ]}
                onPress={handleRecordPress}
                disabled={!isReady || isProcessing || isProcessingLLM}
              >
                {isProcessing || isProcessingLLM ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Feather name={isRecording ? "square" : "mic"} size={32} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {/* Commands Tab - Portable commands synced from Mac */}
            <TouchableOpacity
              style={styles.tabButton}
              onPress={() => navigateToPage(2)}
            >
              <Feather
                name="command"
                size={22}
                color={lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(2))}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(2)) },
                ]}
              >
                Commands
              </Text>
            </TouchableOpacity>

            {/* Tasks Tab - flashes when tasks are saved */}
            {settings.showTodos && (
              <TouchableOpacity
                style={styles.tabButton}
                onPress={() => navigateToPage(3)}
                onLongPress={() => navigateToPage(4)}
                delayLongPress={450}
              >
                <Feather
                  name="check-square"
                  size={22}
                  color={tasksTabFlash ? '#059669' : lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(3))}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color: tasksTabFlash
                        ? '#059669'
                        : lerpHex(TAB_INACTIVE, TAB_ACTIVE, proximityToPage(3)),
                    },
                    tasksTabFlash && styles.tabLabelFlash,
                  ]}
                >
                  Tasks
                </Text>
              </TouchableOpacity>
            )}

          </>
          )}
        </View>
      </KeyboardAvoidingView>
      )}

        </View>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  // Recording indicator - appears at top when recording is active.
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(234, 88, 12, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EA580C',
  },
  recordingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EA580C',
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#E8F5E9',
    gap: 10,
  },
  processingText: {
    fontSize: 14,
    color: '#2E7D32',
  },
  pager: {
    flex: 1,
  },
  transcriptContainer: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  transcriptListWrapper: {
    flex: 1,
  },
  searchHeader: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: '#F4F5F7',
  },
  searchIconButton: {
    alignSelf: 'flex-end',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  topFadeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  settingsPageScroll: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  settingsPageContent: {
    padding: 20,
    paddingBottom: 100,
  },
  pageContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingTop: 8,
  },
  tabButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },
  tabLabelActive: {
    color: '#007AFF',
  },
  tabLabelFlash: {
    color: '#059669',
    fontWeight: '600',
  },
  tabLabelDisabled: {
    color: '#D1D5DB',
  },
  // Save button in create mode - styled like a prominent action
  saveTabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginHorizontal: 8,
    gap: 8,
  },
  saveTabButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  saveTabButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  saveTabButtonTextDisabled: {
    color: '#9CA3AF',
  },
  deleteTabLabel: {
    color: '#DC2626',
  },
  stackTabLabel: {
    color: '#2563EB',
  },
  unstackTabLabel: {
    color: '#7C3AED',
  },
  editTabLabel: {
    color: '#059669',
  },
  selectionBottomButtonDisabled: {
    opacity: 0.4,
  },
  recordButtonContainer: {
    top: -20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  recordButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  recordButtonActive: {
    backgroundColor: '#DC2626',
  },
  recordButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  recordButtonText: { // Keep for fallback/types but unused with icon
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  syncSection: {
    marginTop: 24,
    gap: 12,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  syncStatusText: {
    fontSize: 13,
    color: '#4B5563',
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  actionButton: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 20,
    color: '#000',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 16,
    color: '#000',
  },
  modalButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
    paddingHorizontal: 20,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  settingsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 20,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  settingDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  errorBoundaryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F5F5F5',
  },
  errorBoundaryTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#DC2626',
    marginBottom: 12,
  },
  errorBoundaryText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorBoundaryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorBoundaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});
