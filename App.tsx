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
  SectionList,
  Vibration,
  AppState,
  TextInput,
  RefreshControl,
  SafeAreaView,
  PanResponder,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  LayoutRectangle,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useWhisperRecording } from './hooks/useWhisperRecording';
import { useHeadsetControls } from './hooks/useHeadsetControls';
import { useState, useEffect, useCallback, useMemo, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { ensureModelAvailable } from './services/modelService';
import PagerView from 'react-native-pager-view';
import { TodoList } from './components/TodoList';
import { ObservationList } from './components/ObservationList';
import { CursorBrowser, CursorBrowserHandle } from './components/CursorBrowser';
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

type LayoutBox = { x: number; y: number; width: number; height: number };
type StackDragState = {
  source: TranscriptEntry;
  position: { x: number; y: number };
  offset: { x: number; y: number };
};

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
  const [settings, setSettings] = useState<Settings>({ autoStart: false });
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
  const [dragState, setDragState] = useState<StackDragState | null>(null);
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const transcriptLayoutsRef = useRef<Record<string, LayoutBox>>({});
  const listLayoutRef = useRef<LayoutRectangle>({ x: 0, y: 0, width: 0, height: 0 });
  const scrollOffsetRef = useRef(0);
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

  // Track pull-to-record gesture state so we can show the spinner while starting a recording.
  const [isPullRecording, setIsPullRecording] = useState(false);

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
    const validIds = new Set(transcripts.map((entry) => entry.id));
    const layoutMap = transcriptLayoutsRef.current;
    Object.keys(layoutMap).forEach((id) => {
      if (!validIds.has(id)) {
        delete layoutMap[id];
      }
    });
  }, [transcripts]);

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

  // Process transcription with LLM when it becomes available
  useEffect(() => {
    if (transcription && transcription.trim().length > 0) {
      handleProcessTranscription(transcription);
    }
  }, [transcription, handleProcessTranscription]);

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

  /**
   * Handle "pull to record" on the transcripts list.
   * We only start a new recording if one is not already in progress.
   * The RefreshControl spinner is just a visual affordance while we kick off recording.
   */
  const handlePullToRecord = useCallback(async () => {
    if (isRecording) {
      // If a recording is already running, ignore the gesture to avoid surprising stops.
      return;
    }

    setIsPullRecording(true);
    try {
      await startRecording();
      manuallyStoppedRef.current = false;
    } catch (err) {
      console.error('Pull-to-record failed:', err);
    } finally {
      setIsPullRecording(false);
    }
  }, [isRecording, startRecording]);

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

  const handleToggleAutoStart = useCallback(async (value: boolean) => {
    const newSettings = { ...settings, autoStart: value };
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

  const handleDeleteTranscript = (id: string) => {
    Alert.alert('Delete transcription?', 'This removes the text from your device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
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
        },
      },
    ]);
  };

  // Send transcribed text to Cursor's agent dashboard.
  // This pastes the text into Cursor's input field and switches to the browser view.
  const handleSendToCursor = useCallback((text: string) => {
    // Paste the text into Cursor's input field.
    cursorBrowserRef.current?.pasteText(text);
    
    // Switch to the Cursor browser page (index 3 in the pager).
    pagerRef.current?.setPage(3);
    setPageIndex(3);
    
    // Provide haptic feedback.
    Vibration.vibrate();
  }, []);

  // Keep a rolling map of card bounds so we can detect where the user is dropping.
  const registerTranscriptLayout = useCallback((id: string, layout: LayoutRectangle) => {
    transcriptLayoutsRef.current[id] = {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    };
  }, []);

  // Track the viewport for the SectionList so we can translate touch coordinates.
  const handleTranscriptsLayout = useCallback((event: LayoutChangeEvent) => {
    listLayoutRef.current = event.nativeEvent.layout;
  }, []);

  const handleTranscriptsScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  // Translate the finger position into list-space and return whichever card sits under it.
  const findDropTarget = useCallback((x: number, y: number, sourceId: string) => {
    const listLayout = listLayoutRef.current;
    const contentX = x - listLayout.x;
    const contentY = y - listLayout.y + scrollOffsetRef.current;

    for (const [id, box] of Object.entries(transcriptLayoutsRef.current)) {
      if (id === sourceId) continue;
      const withinX = contentX >= box.x && contentX <= box.x + box.width;
      const withinY = contentY >= box.y && contentY <= box.y + box.height;
      if (withinX && withinY) {
        return id;
      }
    }

    return null;
  }, []);

  const updateDragPosition = useCallback((x: number, y: number) => {
    setDragState((prev) => {
      if (!prev) {
        return prev;
      }
      const targetId = findDropTarget(x, y, prev.source.id);
      setActiveDropTargetId(targetId);
      return {
        ...prev,
        position: { x, y },
      };
    });
  }, [findDropTarget]);

  // Merge two transcripts together so the drop target becomes the parent stack.
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
      const updatedTarget: TranscriptEntry = {
        ...targetEntry,
        text: buildStackText(mergedSegments),
        stackSegments: mergedSegments,
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

  const finalizeDrag = useCallback((x: number, y: number) => {
    setDragState((current) => {
      if (!current) {
        return null;
      }

      const dropTargetId = findDropTarget(x, y, current.source.id);
      if (dropTargetId) {
        stackTranscripts(current.source.id, dropTargetId);
      }

      setActiveDropTargetId(null);
      return null;
    });
  }, [findDropTarget, stackTranscripts]);

  const handleStartStackDrag = useCallback((entry: TranscriptEntry, event: GestureResponderEvent) => {
    if (dragState || transcripts.length < 2) {
      return;
    }

    const { pageX, pageY, locationX, locationY } = event.nativeEvent;
    setDragState({
      source: entry,
      position: { x: pageX, y: pageY },
      offset: { x: locationX, y: locationY },
    });
    setActiveDropTargetId(null);
    Vibration.vibrate(10);
  }, [dragState, transcripts.length]);

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

  const dragPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => Boolean(dragState),
        onMoveShouldSetPanResponderCapture: () => Boolean(dragState),
        onPanResponderMove: (_event, gestureState) => {
          updateDragPosition(gestureState.moveX, gestureState.moveY);
        },
        onPanResponderRelease: (_event, gestureState) => {
          finalizeDrag(gestureState.moveX, gestureState.moveY);
        },
        onPanResponderTerminate: (_event, gestureState) => {
          finalizeDrag(gestureState.moveX, gestureState.moveY);
        },
      }),
    [dragState, finalizeDrag, updateDragPosition],
  );

  const renderTranscriptItem = ({ item }: { item: TranscriptEntry }) => {
    const isExpanded = Boolean(expandedMap[item.id]);
    const isCopied = copiedId === item.id;
    const shouldShowExpand = item.text.length > 160 || item.text.includes('\n');
    const stackCount = item.stackSegments?.length ?? 1;
    const isStacked = stackCount > 1;
    const isDragSource = dragState?.source.id === item.id;
    const isDropTarget = activeDropTargetId === item.id;

    const handleExpandPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleToggleExpand(item.id);
    };

    const handleSendToCursorPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleSendToCursor(item.text);
    };

    const handleDeletePress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleDeleteTranscript(item.id);
    };

    const handleUnstackPress = (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleUnstackTranscript(item.id);
    };

    const handlePressOut = (event: GestureResponderEvent) => {
      if (dragState?.source.id === item.id) {
        finalizeDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
      }
    };

    return (
      <Pressable
        onPress={() => handleCopyTranscript(item)}
        onLongPress={(event) => handleStartStackDrag(item, event)}
        delayLongPress={250}
        android_ripple={{ color: '#E2E8F0' }}
        onLayout={(event) => registerTranscriptLayout(item.id, event.nativeEvent.layout)}
        onPressOut={handlePressOut}
        style={({ pressed }) => [
          styles.transcriptCard,
          pressed && styles.transcriptCardPressed,
          isCopied && styles.transcriptCardCopied,
          isDropTarget && styles.transcriptCardDropTarget,
          isDragSource && styles.transcriptCardDragging,
        ]}
      >
        <View style={styles.transcriptHeader}>
          <Text style={styles.transcriptTime}>{formatTime(item.createdAt)}</Text>
          <View style={styles.transcriptHeaderRight}>
            {isStacked && (
              <View style={styles.stackBadge}>
                <Feather name="layers" size={12} color="#1D4ED8" />
                <Text style={styles.stackBadgeText}>{stackCount}</Text>
              </View>
            )}
            {isCopied && <Text style={styles.copiedLabel}>Copied</Text>}
          </View>
        </View>
        <Text
          style={styles.transcriptText}
          numberOfLines={isExpanded ? undefined : MAX_PREVIEW_LINES}
        >
          {item.text}
        </Text>
        <View style={styles.transcriptActions}>
          {shouldShowExpand && (
            <TouchableOpacity
              onPress={handleExpandPress}
              hitSlop={8}
              style={styles.expandButton}
            >
              <Text style={styles.expandButtonText}>{isExpanded ? 'Show less' : 'Expand'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleSendToCursorPress}
            hitSlop={8}
            style={styles.sendToCursorButton}
          >
            <Feather name="terminal" size={14} color="#059669" />
            <Text style={styles.sendToCursorText}>Send to Cursor</Text>
          </TouchableOpacity>
          {isStacked && (
            <TouchableOpacity
              onPress={handleUnstackPress}
              hitSlop={8}
              style={styles.unstackButton}
            >
              <Feather name="shuffle" size={14} color="#7C3AED" />
              <Text style={styles.unstackButtonText}>Unstack</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleDeletePress}
            hitSlop={8}
            style={styles.deleteButton}
          >
            <Feather name="trash-2" size={14} color="#DC2626" />
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  };

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
      <SafeAreaView style={styles.safeArea} {...dragPanResponder.panHandlers}>
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

      {/* Processing indicator */}
      {(isProcessing || isProcessingLLM) && (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.processingText}>
            {isProcessing ? 'Transcribing...' : 'Separating transcript into tasks and observations'}
          </Text>
        </View>
      )}

      {/* Pager View */}
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
          <View style={styles.transcriptHeaderControls}>
            {pageIndex === 0 && (
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
            )}
          </View>
        <View style={styles.transcriptListWrapper} onLayout={handleTranscriptsLayout}>
          {sections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No transcripts yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap "Record" to capture the first note.
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
              refreshControl={
                <RefreshControl
                  refreshing={isPullRecording}
                  onRefresh={handlePullToRecord}
                />
              }
              onScroll={handleTranscriptsScroll}
              scrollEnabled={!dragState}
              scrollEventThrottle={16}
            />
          )}
        </View>
        </View>
        <View key="todos" style={styles.pageContainer}>
          <View style={styles.transcriptHeaderControls}>
            {pageIndex === 1 && (
              <TouchableOpacity
                style={styles.sortButton}
                onPress={() =>
                  setTodosSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
                }
              >
                <Text style={styles.sortButtonText}>
                  {todosSortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <TodoList
            sections={todosSections}
            onToggleComplete={handleToggleComplete}
            onUpdate={handleUpdateTodo}
            onDelete={handleDeleteTodo}
            formatTime={formatTime}
            formatDateHeader={formatDateHeader}
            onRefresh={handlePullToRecord}
            refreshing={isPullRecording}
          />
        </View>
        <View key="observations" style={styles.pageContainer}>
          <View style={styles.transcriptHeaderControls}>
            {pageIndex === 2 && (
              <TouchableOpacity
                style={styles.sortButton}
                onPress={() =>
                  setObservationsSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
                }
              >
                <Text style={styles.sortButtonText}>
                  {observationsSortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <ObservationList
            sections={observationsSections}
            onUpdate={handleUpdateObservation}
            onDelete={handleDeleteObservation}
            formatTime={formatTime}
            formatDateHeader={formatDateHeader}
            onRefresh={handlePullToRecord}
            refreshing={isPullRecording}
          />
        </View>
        <View key="cursor" style={styles.pageContainer}>
          <CursorBrowser ref={cursorBrowserRef} />
        </View>
      </PagerView>

      {/* NEW BOTTOM BAR LAYOUT */}
      <View style={styles.bottomBar}>
        {/* Transcripts Tab */}
        <TouchableOpacity 
          style={styles.tabButton} 
          onPress={() => pagerRef.current?.setPage(0)}
        >
          <Feather 
            name="file-text" 
            size={22} 
            color={pageIndex === 0 ? '#007AFF' : '#9CA3AF'} 
          />
        </TouchableOpacity>

        {/* Tasks Tab */}
        <TouchableOpacity 
          style={styles.tabButton} 
          onPress={() => pagerRef.current?.setPage(1)}
        >
          <Feather 
            name="check-square" 
            size={22} 
            color={pageIndex === 1 ? '#007AFF' : '#9CA3AF'} 
          />
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

        {/* Observations Tab */}
        <TouchableOpacity 
          style={styles.tabButton} 
          onPress={() => pagerRef.current?.setPage(2)}
        >
          <Feather 
            name="eye" 
            size={22} 
            color={pageIndex === 2 ? '#007AFF' : '#9CA3AF'} 
          />
        </TouchableOpacity>

        {/* Cursor Tab */}
        <TouchableOpacity 
          style={styles.tabButton} 
          onPress={() => pagerRef.current?.setPage(3)}
        >
          <Feather 
            name="terminal" 
            size={22} 
            color={pageIndex === 3 ? '#007AFF' : '#9CA3AF'} 
          />
        </TouchableOpacity>

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
        </TouchableOpacity>
      </View>

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
        {dragState && (
          <>
            <View style={styles.stackHint} pointerEvents="none">
              <Feather name="move" size={14} color="#2563EB" />
              <Text style={styles.stackHintText}>Drag onto another note to stack</Text>
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.dragOverlay,
                {
                  top: Math.min(
                    Math.max(dragState.position.y - dragState.offset.y, 0),
                    windowHeight - 80,
                  ),
                  left: Math.min(
                    Math.max(dragState.position.x - dragState.offset.x, 0),
                    windowWidth - 120,
                  ),
                },
              ]}
            >
              <View style={styles.dragOverlayCard}>
                <Text style={styles.dragOverlayText} numberOfLines={4}>
                  {dragState.source.text}
                </Text>
              </View>
            </View>
          </>
        )}
        </View>
      </SafeAreaView>
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
  transcriptHeaderControls: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#F5F5F5',
    minHeight: 44, // Reserve space for sort button to prevent layout shift
  },
  sortButton: {
    alignSelf: 'flex-end',
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
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingBottom: 30, // Safe area for modern iPhones
    paddingTop: 10,
    height: 90,
  },
  tabButton: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonContainer: {
    top: -30, // Float above
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.30,
    shadowRadius: 4.65,
    elevation: 8,
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36, // Circle
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff', // White border to separate from background content
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
  transcriptCardDropTarget: {
    borderColor: '#2563EB',
    borderWidth: 2,
  },
  transcriptCardDragging: {
    opacity: 0.6,
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transcriptHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transcriptTime: {
    fontSize: 13,
    color: '#6B7280',
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
  transcriptActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  expandButton: {
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
  unstackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F5F3FF',
    gap: 5,
  },
  unstackButtonText: {
    fontSize: 13,
    fontWeight: '600',
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
  stackHint: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 999,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  stackHintText: {
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  dragOverlay: {
    position: 'absolute',
    zIndex: 20,
    maxWidth: '85%',
  },
  dragOverlayCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
  },
  dragOverlayText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
});
