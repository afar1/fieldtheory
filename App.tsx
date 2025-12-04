import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Modal,
  Alert,
  GestureResponderEvent,
  Pressable,
  Vibration,
  AppState,
  TextInput,
  SafeAreaView,
  FlatList,
  RefreshControl,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useWhisperRecording } from './hooks/useWhisperRecording';
import { useHeadsetControls } from './hooks/useHeadsetControls';
import { useState, useEffect, useCallback, useMemo, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { ensureModelAvailable } from './services/modelService';
import PagerView from 'react-native-pager-view';
import { TodoList } from './components/TodoList';
import { ObservationList } from './components/ObservationList';
import { CursorBrowser, CursorBrowserHandle } from './components/CursorBrowser';
import { PullToCreate } from './components/PullToCreate';
import { StorageService } from './services/storage';
import { processTranscription } from './services/llm';
import { Todo, Observation, Settings, TranscriptEntry, TranscriptSegment } from './types';
import { requestOtp, verifyOtp, getSession, signOut as supabaseSignOut } from './services/auth';
import { syncAll, seedRemoteFromLocal } from './services/sync';
import { supabase } from './services/supabase';
import type { Session } from '@supabase/supabase-js';

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
  console.log('[App] Component rendering');
  
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
  const [todos, setTodos] = useState<Todo[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  // Default settings with all features enabled
  const [settings, setSettings] = useState<Settings>({
    autoStart: false,
    showTodos: true,
    showObservations: true,
    showCursor: true,
    autoSeparate: true,
  });
  const [isProcessingLLM, setIsProcessingLLM] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  
  // Transcript history state
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [todosSortOrder, setTodosSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [observationsSortOrder, setObservationsSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Selection mode state for multi-select stacking and deleting
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Track which specific item is being processed for "Separate Tasks"
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);
  
  // Track which items have had tasks separated (so we show "Tasks Saved" instead of button)
  const [separatedIds, setSeparatedIds] = useState<Set<string>>(new Set());
  
  // Track create mode state from PullToCreate - used to show dynamic bottom bar
  const [createMode, setCreateMode] = useState<{
    isCreating: boolean;
    itemType: 'stack' | 'task' | 'observation' | null;
    text: string;
    save: (() => void) | null;
    cancel: (() => void) | null;
  }>({ isCreating: false, itemType: null, text: '', save: null, cancel: null });
  
  // Track keyboard height to position bottom bar above suggestions
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  // Brief flash for Tasks tab when tasks are saved
  const [tasksTabFlash, setTasksTabFlash] = useState(false);
  type PagerRef = React.ComponentRef<typeof PagerView>;
  const pagerRef = useRef<PagerRef>(null);
  const cursorBrowserRef = useRef<CursorBrowserHandle>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isSyncingData, setIsSyncingData] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  
  // Track last processed transcription to prevent loops/duplicate processing
  const lastProcessedText = useRef<string | null>(null);
  // Track if we've auto-started recording on this app session (only once per launch)
  const hasAutoStartedRef = useRef<boolean>(false);
  // Track previous app state to detect foreground transitions
  const appStateRef = useRef<string>(AppState.currentState);
  // Track if user manually stopped recording (prevents auto-start until they manually start again)
  const manuallyStoppedRef = useRef<boolean>(false);

  // Load data from storage on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [loadedTodos, loadedObservations, loadedSettings, loadedTranscripts] = await Promise.all([
          StorageService.getTodos(),
          StorageService.getObservations(),
          StorageService.getSettings(),
          StorageService.getTranscripts(),
        ]);
        setTodos(loadedTodos);
        setObservations(loadedObservations);
        setSettings(loadedSettings);
        setTranscripts(loadedTranscripts);
      } catch (err) {
        console.error('Failed to load data from storage:', err);
        // Continue with empty state if storage fails
      } finally {
        setIsInitialized(true);
      }
    }
    loadData();
  }, []);

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

  useEffect(() => {
    let isMounted = true;

    getSession()
      .then((currentSession) => {
        if (isMounted) {
          setSession(currentSession);
        }
      })
      .catch((err) => console.error('Failed to fetch Supabase session:', err));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setSyncedAt(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
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

  useEffect(() => {
    pagerRef.current?.setPage(pageIndex);
  }, [pageIndex]);

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

  // Configure audio session for headset controls
  useHeadsetControls();

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
        !isDownloadingModel &&
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
        syncAll().catch((error) => {
          // Log error but don't interrupt user experience
          console.error('Background sync failed:', error);
        });
      }
      
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [settings.autoStart, isReady, isRecording, isProcessing, isDownloadingModel, startRecording, session]);

  // Capture every finished transcription so we can build the timeline.
  useEffect(() => {
    if (transcription === null) {
      return;
    }

    const cleanedText =
      transcription.trim().length > 0
        ? transcription.trim()
        : 'No speech detected in this recording.';

    const newEntry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: cleanedText,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setTranscripts((prev) => {
      const updated = [newEntry, ...prev];
      // Save to storage whenever transcripts change
      StorageService.saveTranscripts(updated).catch(console.error);
      // Auto-copy transcription to clipboard after it's added
      Clipboard.setStringAsync(cleanedText).catch(console.error);
      return updated;
    });
  }, [transcription]);

  const handleProcessTranscription = useCallback(async (text: string) => {
    // Prevent re-processing the same text (breaks dependency loop)
    if (text === lastProcessedText.current) return;
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
      ]);
    } catch (err) {
      console.error('Failed to process transcription:', err);
    } finally {
      setIsProcessingLLM(false);
    }
  }, [todos, observations]);

  // Process transcription with LLM when it becomes available (only if auto-separate is enabled)
  // Also marks the transcript as separated when done and flashes the Tasks tab
  useEffect(() => {
    if (transcription && transcription.trim().length > 0 && settings.autoSeparate) {
      // Find the transcript that matches this text (most recent one)
      const matchingEntry = transcripts.find(t => t.text === transcription.trim() || t.text === 'No speech detected in this recording.');
      
      handleProcessTranscription(transcription).then(() => {
        if (matchingEntry) {
          setSeparatedIds((prev) => new Set(prev).add(matchingEntry.id));
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

  const sortedObservations = useMemo(() => {
    return [...observations].sort((a, b) =>
      observationsSortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
    );
  }, [observations, observationsSortOrder]);

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

  const observationsSections = useMemo(() => {
    const grouped: { key: string; title: string; data: Observation[] }[] = [];
    const sectionIndex: Record<string, number> = {};

    sortedObservations.forEach((observation) => {
      const key = getDateKey(observation.createdAt);

      if (sectionIndex[key] === undefined) {
        sectionIndex[key] = grouped.length;
        grouped.push({
          key,
          title: formatDateHeader(observation.createdAt),
          data: [],
        });
      }

      grouped[sectionIndex[key]].data.push(observation);
    });

    return grouped;
  }, [sortedObservations]);

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
      setSession(currentSession);
      setAuthNotice('Signed in. You can sync now.');
      setOtpCode('');
    } catch (err) {
      console.error('Failed to verify OTP:', err);
      Alert.alert('Verification failed', err instanceof Error ? err.message : 'Unable to verify the code right now.');
    } finally {
      setIsVerifyingOtp(false);
    }
  }, [authEmail, otpCode]);

  const handleSignOutPress = useCallback(async () => {
    try {
      await supabaseSignOut();
      setSession(null);
      setSyncNotice(null);
      setAuthNotice('Signed out.');
    } catch (err) {
      console.error('Failed to sign out:', err);
      Alert.alert('Sign out failed', err instanceof Error ? err.message : 'Unable to sign out.');
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    setIsSyncingData(true);
    setSyncNotice(null);

    try {
      const result = await syncAll();
      const [nextTodos, nextObservations, nextTranscripts] = await Promise.all([
        StorageService.getTodos(),
        StorageService.getObservations(),
        StorageService.getTranscripts(),
      ]);

      setTodos(nextTodos);
      setObservations(nextObservations);
      setTranscripts(nextTranscripts);
      setSyncedAt(result.syncedAt);
      setSyncNotice('Synced with Supabase.');
    } catch (err) {
      console.error('Sync failed:', err);
      Alert.alert('Sync failed', err instanceof Error ? err.message : 'Unable to sync right now.');
    } finally {
      setIsSyncingData(false);
    }
  }, []);

  const handleSeedNow = useCallback(async () => {
    setIsSeeding(true);
    setSyncNotice(null);

    try {
      await seedRemoteFromLocal();
      setSyncNotice('Seeded current device data to Supabase.');
    } catch (err) {
      console.error('Seed failed:', err);
      Alert.alert('Seed failed', err instanceof Error ? err.message : 'Unable to seed right now.');
    } finally {
      setIsSeeding(false);
    }
  }, []);

  const handleToggleComplete = useCallback(async (id: string) => {
    const newTodos = todos.map((t) =>
      t.id === id ? { ...t, completed: !t.completed, updatedAt: Date.now() } : t
    );
    setTodos(newTodos);
    await StorageService.saveTodos(newTodos);
  }, [todos]);

  const handleUpdateTodo = useCallback(async (id: string, text: string) => {
    const newTodos = todos.map((t) => (t.id === id ? { ...t, text, updatedAt: Date.now() } : t));
    setTodos(newTodos);
    await StorageService.saveTodos(newTodos);
  }, [todos]);

  const handleDeleteTodo = useCallback(async (id: string) => {
    const newTodos = todos.filter((t) => t.id !== id);
    setTodos(newTodos);
    await StorageService.saveTodos(newTodos);
  }, [todos]);

  const handleUpdateObservation = useCallback(async (id: string, text: string) => {
    const newObservations = observations.map((o) => (o.id === id ? { ...o, text, updatedAt: Date.now() } : o));
    setObservations(newObservations);
    await StorageService.saveObservations(newObservations);
  }, [observations]);

  const handleDeleteObservation = useCallback(async (id: string) => {
    const newObservations = observations.filter((o) => o.id !== id);
    setObservations(newObservations);
    await StorageService.saveObservations(newObservations);
  }, [observations]);

  // Create a new task via pull-to-create.
  const handleCreateTask = useCallback(async (text: string): Promise<boolean> => {
    const newTodo: Todo = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const newTodos = [newTodo, ...todos];
    setTodos(newTodos);
    await StorageService.saveTodos(newTodos);
    return true;
  }, [todos]);

  // Create a new observation via pull-to-create.
  const handleCreateObservation = useCallback(async (text: string): Promise<boolean> => {
    const newObs: Observation = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const newObservations = [newObs, ...observations];
    setObservations(newObservations);
    await StorageService.saveObservations(newObservations);
    return true;
  }, [observations]);

  // Create a new transcript via pull-to-create.
  const handleCreateTranscript = useCallback(async (text: string): Promise<boolean> => {
    const newEntry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const newTranscripts = [newEntry, ...transcripts];
    setTranscripts(newTranscripts);
    await StorageService.saveTranscripts(newTranscripts);
    return true;
  }, [transcripts]);

  // Handle create mode changes from PullToCreate - used to show dynamic bottom bar.
  const handleStackCreateModeChange = useCallback((isCreating: boolean, text: string, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'stack', text, save, cancel });
  }, []);

  const handleTaskCreateModeChange = useCallback((isCreating: boolean, text: string, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'task', text, save, cancel });
  }, []);

  const handleObservationCreateModeChange = useCallback((isCreating: boolean, text: string, save: () => void, cancel: () => void) => {
    setCreateMode({ isCreating, itemType: 'observation', text, save, cancel });
  }, []);

  const handleToggleAutoStart = useCallback(async (value: boolean) => {
    const newSettings = { ...settings, autoStart: value };
    setSettings(newSettings);
    await StorageService.saveSettings(newSettings);
  }, [settings]);

  const handleToggleSetting = useCallback(async (key: keyof Settings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await StorageService.saveSettings(newSettings);
  }, [settings]);

  const handleCopyTranscript = async (entry: TranscriptEntry) => {
    await Clipboard.setStringAsync(entry.text);
    Vibration.vibrate();
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

  const handleDeleteTranscript = useCallback((id: string) => {
    setTranscripts((prev) => {
      const updated = prev.filter((entry) => entry.id !== id);
      // Save to storage when deleting
      StorageService.saveTranscripts(updated).catch(console.error);
      return updated;
    });
    setExpandedMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Transcript editing state
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editTranscriptText, setEditTranscriptText] = useState('');

  const handleUpdateTranscript = useCallback(async (id: string, text: string) => {
    const updated = transcripts.map((t) => 
      t.id === id ? { ...t, text: text.trim(), updatedAt: Date.now() } : t
    );
    setTranscripts(updated);
    await StorageService.saveTranscripts(updated);
    setEditingTranscriptId(null);
    setEditTranscriptText('');
  }, [transcripts]);

  const handleEditTranscript = useCallback((transcript: TranscriptEntry) => {
    setEditingTranscriptId(transcript.id);
    setEditTranscriptText(transcript.text);
  }, []);

  const handleCancelEditTranscript = useCallback(() => {
    setEditingTranscriptId(null);
    setEditTranscriptText('');
  }, []);

  // Send transcribed text to Cursor's agent dashboard.
  // This pastes the text into Cursor's input field and switches to the browser view.
  const handleSendToCursor = useCallback((text: string) => {
    // Dismiss keyboard before navigating to prevent it from staying open.
    Keyboard.dismiss();
    
    // Paste the text into Cursor's input field.
    cursorBrowserRef.current?.pasteText(text);
    
    // Cursor is always at page 1 (right after Transcripts).
    const cursorPageIndex = 1;
    
    // Switch to the Cursor browser page.
    pagerRef.current?.setPage(cursorPageIndex);
    setPageIndex(cursorPageIndex);
    
    // Provide haptic feedback.
    Vibration.vibrate();
  }, []);

  // Manually separate a transcript into tasks and observations.
  // This is used when auto-separate is disabled.
  const handleManualSeparate = useCallback(async (text: string, itemId: string) => {
    if (isProcessingLLM) return; // Don't allow multiple separations at once
    
    Vibration.vibrate();
    setProcessingItemId(itemId);
    await handleProcessTranscription(text);
    setProcessingItemId(null);
    
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

      StorageService.saveTranscripts(updatedList).catch(console.error);

      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        delete next[sourceId];
        if (mergedSegments.length > 1) {
          next[targetId] = true;
        }
        return next;
      });

      setCopiedId((prevCopied) => (prevCopied === sourceId ? null : prevCopied));

      return updatedList;
    });
  }, [setExpandedMap, setCopiedId]);

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

      StorageService.saveTranscripts(updatedList).catch(console.error);

      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        delete next[id];
        return next;
      });

      return updatedList;
    });
  }, [setExpandedMap]);

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
  }, [selectedIds]);

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

      StorageService.saveTranscripts(updatedList).catch(console.error);

      // Expand the resulting stack so user sees the merged content.
      setExpandedMap((prevExpanded) => {
        const next = { ...prevExpanded };
        sourceIds.forEach((id) => delete next[id]);
        next[targetEntry.id] = true;
        return next;
      });

      return updatedList;
    });

    exitSelectionMode();
  }, [selectedIds, sortedTranscripts, exitSelectionMode]);

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

  // Render a single transcript item with selection mode support.
  const renderTranscriptItem = useCallback(({ item, index }: { item: TranscriptEntry; index: number }) => {
    const isExpanded = Boolean(expandedMap[item.id]);
    const isCopied = copiedId === item.id;
    const shouldShowExpand = item.text.length > 160 || item.text.includes('\n');
    const stackCount = item.stackSegments?.length ?? 1;
    const isStacked = stackCount > 1;
    const isSelected = selectedIds.has(item.id);
    const isProcessingThis = processingItemId === item.id;
    const isSeparated = separatedIds.has(item.id);

    // Show inline date header if this is the first item or different date from previous.
    const prevItem = index > 0 ? sortedTranscripts[index - 1] : null;
    const showDateHeader = !prevItem || getDateKey(item.createdAt) !== getDateKey(prevItem.createdAt);

    const handleExpandPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleToggleExpand(item.id);
    };

    const handleSendToCursorPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleSendToCursor(item.text);
    };

    const handleFindTasksPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleManualSeparate(item.text, item.id);
    };

    // Long-press on stack badge to unstack
    const handleStackBadgeLongPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleUnstackTranscript(item.id);
    };

    // In selection mode, tap toggles selection. Otherwise, tap copies.
    const handlePress = () => {
      if (selectionMode) {
        toggleSelection(item.id);
      } else {
        handleCopyTranscript(item);
      }
    };

    // Long-press enters selection mode with this item selected.
    const handleLongPress = () => {
      if (!selectionMode) {
        enterSelectionMode(item.id);
      }
    };

    return (
      <View>
        {/* Inline date header - shown when date changes */}
        {showDateHeader && (
          <View style={styles.inlineDateHeader}>
            <Text style={styles.inlineDateHeaderText}>{formatDateHeader(item.createdAt)}</Text>
          </View>
        )}
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={85}
          android_ripple={{ color: '#E2E8F0' }}
          style={[
            styles.transcriptCard,
            isCopied && styles.transcriptCardCopied,
            isSelected && styles.transcriptCardSelected,
          ]}
        >
          {/* Floating checkbox overlay - positioned top-left of card */}
          {selectionMode && (
            <TouchableOpacity
              onPress={() => toggleSelection(item.id)}
              style={styles.checkboxOverlay}
              hitSlop={8}
            >
              <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
                {isSelected && <Feather name="check" size={12} color="#fff" />}
              </View>
            </TouchableOpacity>
          )}
          
          {/* Top row: Time + Stack badge on left, Edit button on right */}
          <View style={styles.transcriptHeader}>
            <View style={styles.transcriptHeaderLeft}>
              <Text style={[styles.transcriptTime, isCopied && styles.transcriptTimeCopied]}>
                {isCopied ? 'Copied!' : formatTime(item.createdAt)}
              </Text>
              {/* Stack badge - next to time */}
              {isStacked && (
                <TouchableOpacity
                  onLongPress={handleStackBadgeLongPress}
                  delayLongPress={85}
                  style={styles.stackBadge}
                  hitSlop={8}
                  disabled={selectionMode}
                >
                  <Feather name="layers" size={12} color={selectionMode ? '#9CA3AF' : '#1D4ED8'} />
                  <Text style={[styles.stackBadgeText, selectionMode && styles.stackBadgeTextDisabled]}>{stackCount}</Text>
                </TouchableOpacity>
              )}
            </View>
            {/* Edit button - top right */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleEditTranscript(item);
              }}
              hitSlop={8}
              style={[styles.editButton, selectionMode && styles.actionButtonDisabled]}
              disabled={selectionMode}
            >
              <Feather name="edit-2" size={14} color={selectionMode ? '#9CA3AF' : '#6B7280'} />
            </TouchableOpacity>
          </View>
          
          {/* Main text content - show TextInput when editing */}
          {editingTranscriptId === item.id ? (
            <View style={styles.transcriptEditContainer}>
              <TextInput
                style={styles.transcriptEditInput}
                value={editTranscriptText}
                onChangeText={setEditTranscriptText}
                multiline
                autoFocus
                textAlignVertical="top"
                returnKeyType="default"
              />
              <View style={styles.transcriptEditActions}>
                <TouchableOpacity
                  onPress={handleCancelEditTranscript}
                  style={styles.transcriptEditCancel}
                >
                  <Text style={styles.transcriptEditCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleUpdateTranscript(item.id, editTranscriptText)}
                  style={[
                    styles.transcriptEditSave,
                    !editTranscriptText.trim() && styles.transcriptEditSaveDisabled,
                  ]}
                  disabled={!editTranscriptText.trim()}
                >
                  <Text style={styles.transcriptEditSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text
              style={styles.transcriptText}
              numberOfLines={isExpanded ? undefined : MAX_PREVIEW_LINES}
            >
              {item.text}
            </Text>
          )}
          
          {/* Bottom row: Action buttons on left, Expand button on right */}
          <View style={styles.transcriptFooter}>
            <View style={styles.transcriptActions}>
              {/* Send to Cursor button - only shown when Cursor tab is enabled */}
              {settings.showCursor && (
                <TouchableOpacity
                  onPress={handleSendToCursorPress}
                  hitSlop={8}
                  style={[styles.sendToCursorButton, selectionMode && styles.actionButtonDisabled]}
                  disabled={selectionMode}
                >
                  <Feather name="terminal" size={14} color={selectionMode ? '#9CA3AF' : '#059669'} />
                  <Text style={[styles.sendToCursorText, selectionMode && styles.sendToCursorTextDisabled]}>Send to Cursor</Text>
                </TouchableOpacity>
              )}
              {/* Create Tasks - button when auto-create off, status when auto-create on */}
              {settings.autoSeparate ? (
                // Auto-create is ON - show status
                isProcessingLLM ? (
                  <View style={styles.tasksSavedLabel}>
                    <Feather name="loader" size={14} color="#7C3AED" />
                    <Text style={styles.tasksCreatingText}>Creating tasks...</Text>
                  </View>
                ) : isSeparated ? (
                  <View style={styles.tasksSavedLabel}>
                    <Feather name="check" size={14} color="#059669" />
                    <Text style={styles.tasksSavedText}>Tasks created</Text>
                  </View>
                ) : null
              ) : (
                // Auto-create is OFF - show button
                isSeparated ? (
                  <View style={styles.tasksSavedLabel}>
                    <Feather name="check" size={14} color="#059669" />
                    <Text style={styles.tasksSavedText}>Created</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={handleFindTasksPress}
                    hitSlop={8}
                    style={[styles.separateButton, (selectionMode || isProcessingLLM) && styles.actionButtonDisabled]}
                    disabled={isProcessingLLM || selectionMode}
                  >
                    <Feather name="git-branch" size={14} color={(isProcessingLLM || selectionMode) ? '#9CA3AF' : '#7C3AED'} />
                    <Text style={[styles.separateButtonText, (isProcessingLLM || selectionMode) && styles.separateButtonTextDisabled]}>
                      {isProcessingThis ? 'Creating...' : 'Create Tasks'}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
            {/* Expand/Collapse button - bottom right */}
            {shouldShowExpand && (
              <TouchableOpacity
                onPress={handleExpandPress}
                hitSlop={8}
                style={styles.expandButton}
              >
                <Text style={styles.expandButtonText}>
                  {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </View>
    );
  }, [expandedMap, copiedId, sortedTranscripts, settings.autoSeparate, settings.showCursor, isProcessingLLM, selectionMode, selectedIds, processingItemId, separatedIds, handleToggleExpand, handleSendToCursor, handleManualSeparate, handleUnstackTranscript, handleCopyTranscript, enterSelectionMode, toggleSelection]);

  // Show loading state during initial data load
  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <StatusBar style="auto" />
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
        <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <StatusBar style="auto" />

      {/* Header removed - moved settings to bottom tab */}

      {/* Model download status */}
      {isDownloadingModel && (
        <View style={styles.downloadContainer}>
          <Text style={styles.downloadText}>
            Downloading model... {modelDownloadProgress ? Math.round(modelDownloadProgress * 100) : 0}%
          </Text>
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      )}

      {/* Error display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Processing indicator - only for transcription */}
      {isProcessing && (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.processingText}>Transcribing...</Text>
        </View>
      )}

      {/* Pager View - Order: Transcripts → Cursor → Tasks → Observations */}
      {/* This allows natural swipe-left from Cursor to go back to Transcripts */}
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        onPageSelected={(e) => {
          try {
            setPageIndex(e.nativeEvent.position);
          } catch (err) {
            console.error('Error handling page selection:', err);
          }
        }}
      >
        <View key="transcripts" style={styles.transcriptContainer}>
          <View style={styles.transcriptListWrapper}>
            <PullToCreate
              itemType="transcript"
              onCreateItem={handleCreateTranscript}
              enabled={true}
              style={{ flex: 1 }}
              onCreateModeChange={handleStackCreateModeChange}
            >
              {sortedTranscripts.length === 0 ? (
                <FlatList
                  data={[]}
                  renderItem={() => null}
                  ListEmptyComponent={
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyTitle}>No stacks yet</Text>
                      <Text style={styles.emptySubtitle}>
                        Pull down to type a note, or tap Record.
                      </Text>
                    </View>
                  }
                  contentContainerStyle={{ flex: 1 }}
                />
              ) : (
                <FlatList
                  data={sortedTranscripts}
                  keyExtractor={(item) => item.id}
                  renderItem={renderTranscriptItem}
                  contentContainerStyle={styles.sectionContent}
                />
              )}
            </PullToCreate>
          </View>
        </View>
        <View key="cursor" style={styles.pageContainer}>
          <CursorBrowser ref={cursorBrowserRef} />
        </View>
        <View key="todos" style={styles.pageContainer}>
          <TodoList
            sections={todosSections}
            onToggleComplete={handleToggleComplete}
            onUpdate={handleUpdateTodo}
            onDelete={handleDeleteTodo}
            formatTime={formatTime}
            formatDateHeader={formatDateHeader}
            onCreateTask={handleCreateTask}
            onCreateModeChange={handleTaskCreateModeChange}
          />
        </View>
        <View key="observations" style={styles.pageContainer}>
          <ObservationList
            sections={observationsSections}
            onUpdate={handleUpdateObservation}
            onDelete={handleDeleteObservation}
            formatTime={formatTime}
            formatDateHeader={formatDateHeader}
            onCreateObservation={handleCreateObservation}
            onCreateModeChange={handleObservationCreateModeChange}
          />
        </View>
      </PagerView>

      {/* BOTTOM BAR - Changes based on mode (create > selection > normal) */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={createMode.isCreating && Platform.OS === 'ios' ? 36 : 0} // 36px offset for iOS suggestion bar when creating
      >
        <View style={styles.bottomBar}>
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
                style={[styles.saveTabButton, !createMode.text.trim() && styles.saveTabButtonDisabled]}
                disabled={!createMode.text.trim()}
              >
                <Feather 
                  name="check" 
                  size={22} 
                  color={createMode.text.trim() ? '#fff' : '#9CA3AF'} 
                />
                <Text style={[styles.saveTabButtonText, !createMode.text.trim() && styles.saveTabButtonTextDisabled]}>
                  {createMode.itemType === 'stack' ? 'Save Stack' : 
                   createMode.itemType === 'task' ? 'Save Task' : 
                   'Save Note'}
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
          /* Normal mode: show tab navigation */
          <>
            {/* Stacks Tab */}
            <TouchableOpacity 
              style={styles.tabButton} 
              onPress={() => pagerRef.current?.setPage(0)}
            >
              <Feather 
                name="layers" 
                size={22} 
                color={pageIndex === 0 ? '#007AFF' : '#9CA3AF'} 
              />
              <Text style={[styles.tabLabel, pageIndex === 0 && styles.tabLabelActive]}>
                Stacks
              </Text>
            </TouchableOpacity>

            {/* Cursor Tab */}
            {settings.showCursor && (
              <TouchableOpacity 
                style={styles.tabButton} 
                onPress={() => pagerRef.current?.setPage(1)}
              >
                <Feather 
                  name="terminal" 
                  size={22} 
                  color={pageIndex === 1 ? '#007AFF' : '#9CA3AF'} 
                />
                <Text style={[styles.tabLabel, pageIndex === 1 && styles.tabLabelActive]}>
                  Cursor
                </Text>
              </TouchableOpacity>
            )}

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

            {/* Tasks Tab - flashes when tasks are saved */}
            {settings.showTodos && (
              <TouchableOpacity 
                style={styles.tabButton} 
                onPress={() => pagerRef.current?.setPage(2)}
              >
                <Feather 
                  name="check-square" 
                  size={22} 
                  color={tasksTabFlash ? '#059669' : (pageIndex === 2 ? '#007AFF' : '#9CA3AF')} 
                />
                <Text style={[styles.tabLabel, pageIndex === 2 && styles.tabLabelActive, tasksTabFlash && styles.tabLabelFlash]}>
                  Tasks
                </Text>
              </TouchableOpacity>
            )}

            {/* Observations Tab */}
            {settings.showObservations && (
              <TouchableOpacity 
                style={styles.tabButton} 
                onPress={() => pagerRef.current?.setPage(3)}
              >
                <Feather 
                  name="eye" 
                  size={22} 
                  color={pageIndex === 3 ? '#007AFF' : '#9CA3AF'} 
                />
                <Text style={[styles.tabLabel, pageIndex === 3 && styles.tabLabelActive]}>
                  Notes
                </Text>
              </TouchableOpacity>
            )}

            {/* Settings Tab */}
            <TouchableOpacity 
              style={styles.tabButton} 
              onPress={() => setShowSettings(true)}
            >
              <Feather 
                name="settings" 
                size={22} 
                color="#9CA3AF" 
              />
              <Text style={styles.tabLabel}>
                Settings
              </Text>
            </TouchableOpacity>
          </>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Settings</Text>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Start recording on app open</Text>
              <Switch
                value={settings.autoStart}
                onValueChange={handleToggleAutoStart}
              />
            </View>

            {/* Feature Visibility Section */}
            <Text style={styles.settingsSectionTitle}>Show Features</Text>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Tasks tab</Text>
              <Switch
                value={settings.showTodos}
                onValueChange={(value) => handleToggleSetting('showTodos', value)}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Observations tab</Text>
              <Switch
                value={settings.showObservations}
                onValueChange={(value) => handleToggleSetting('showObservations', value)}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Cursor tab</Text>
              <Switch
                value={settings.showCursor}
                onValueChange={(value) => handleToggleSetting('showCursor', value)}
              />
            </View>

            {/* Separation Section */}
            <Text style={styles.settingsSectionTitle}>Transcript Processing</Text>
            
            <View style={styles.settingRow}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>Auto Create Tasks and Observations</Text>
                <Text style={styles.settingDescription}>
                  {settings.autoSeparate 
                    ? 'Stacks are automatically processed' 
                    : 'Use the Create Tasks button on each stack'}
                </Text>
              </View>
              <Switch
                value={settings.autoSeparate}
                onValueChange={(value) => handleToggleSetting('autoSeparate', value)}
              />
            </View>

            <View style={styles.syncSection}>
              <Text style={styles.sectionHeading}>Supabase Sync</Text>
              <Text style={styles.syncStatusText}>
                {session ? `Signed in as ${session.user.email}` : 'Not signed in'}
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
                    placeholder="6-digit code"
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
                <Text style={styles.syncStatusText}>
                  Last synced at {formatTime(syncedAt)}
                </Text>
              )}
              {syncNotice && <Text style={styles.syncStatusText}>{syncNotice}</Text>}
              {authNotice && <Text style={styles.syncStatusText}>{authNotice}</Text>}
            </View>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowSettings(false)}
            >
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
        </View>
        </SafeAreaView>
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
  downloadContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#E3F2FD',
    gap: 10,
  },
  downloadText: {
    fontSize: 14,
    color: '#1976D2',
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
  pageContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  checkboxOverlay: {
    position: 'absolute',
    top: -4,
    left: -4,
    zIndex: 10,
  },
  checkboxCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCircleSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingBottom: 34,
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
  selectionBottomButtonDisabled: {
    opacity: 0.4,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  sendToCursorTextDisabled: {
    color: '#9CA3AF',
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
  transcriptCardSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#818CF8',
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transcriptHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    padding: 4,
  },
  transcriptFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  transcriptTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  transcriptTimeCopied: {
    color: '#2563EB',
    fontWeight: '600',
  },
  stackBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    gap: 4,
  },
  stackBadgeText: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  stackBadgeTextDisabled: {
    color: '#9CA3AF',
  },
  expandButton: {
    paddingVertical: 4,
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
  transcriptEditContainer: {
    marginTop: 8,
  },
  transcriptEditInput: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    maxHeight: 200,
    backgroundColor: '#F9FAFB',
  },
  transcriptEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  transcriptEditCancel: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  transcriptEditCancelText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  transcriptEditSave: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  transcriptEditSaveDisabled: {
    opacity: 0.5,
  },
  transcriptEditSaveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  transcriptActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  expandButtonText: {
    fontSize: 13,
    color: '#6B7280',
  },
  sendToCursorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    gap: 5,
  },
  sendToCursorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  separateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F3E8FF',
    gap: 5,
  },
  separateButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
  },
  separateButtonTextDisabled: {
    color: '#9CA3AF',
  },
  tasksSavedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  tasksSavedText: {
    fontSize: 13,
    color: '#059669',
  },
  tasksCreatingText: {
    fontSize: 13,
    color: '#7C3AED',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    gap: 5,
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
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
  inlineDateHeader: {
    paddingVertical: 8,
    paddingTop: 16,
  },
  inlineDateHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});

