import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import AudioSettingsPanel from './components/AudioSettingsPanel';
import TranscriptionSettings from './components/TranscriptionSettings';

// Date formatting utilities (matches iOS)
const formatTime = (ms: number) => {
  const date = new Date(ms);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric' }).format(date);
};

const formatDateHeader = (ms: number) => {
  const date = new Date(ms);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
};

const getDateKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

// Cache key for localStorage
const CACHE_KEY = 'littleai-data-cache';

// Cache helper functions
const loadFromCache = () => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

const saveToCache = (data: { todos: TodoRow[]; observations: ObservationRow[]; transcripts: TranscriptRow[] }) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, cachedAt: Date.now() }));
};

// Group items by date, return sections array like iOS
// Sections are ordered based on sortOrder (newest sections first or oldest first)
const groupByDate = <T extends { client_created_at_ms: number }>(
  items: T[],
  sortOrder: 'newest' | 'oldest' = 'newest'
): Array<{ key: string; title: string; data: T[] }> => {
  const grouped: Record<string, T[]> = {};

  // Sort first
  const sorted = [...items].sort((a, b) =>
    sortOrder === 'newest'
      ? b.client_created_at_ms - a.client_created_at_ms
      : a.client_created_at_ms - b.client_created_at_ms
  );

  // Group by date
  sorted.forEach((item) => {
    const key = getDateKey(item.client_created_at_ms);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  // Convert to sections array, maintaining sort order
  const sectionKeys = Object.keys(grouped).sort((a, b) => {
    // Compare dates: newest first or oldest first
    const dateA = new Date(a).getTime();
    const dateB = new Date(b).getTime();
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  return sectionKeys.map((key) => ({
    key,
    title: formatDateHeader(grouped[key][0].client_created_at_ms),
    data: grouped[key],
  }));
};

// Sort todos: incomplete first, then by date within each group
const sortTodos = (todos: TodoRow[], sortOrder: 'newest' | 'oldest') => {
  return [...todos].sort((a, b) => {
    // Incomplete tasks come first
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    // Within each group, sort by date
    return sortOrder === 'newest'
      ? b.client_created_at_ms - a.client_created_at_ms
      : a.client_created_at_ms - b.client_created_at_ms;
  });
};

type TodoRow = {
  id: string;
  text: string;
  completed: boolean;
  client_created_at_ms: number;
  updated_at: string;
};

type ObservationRow = {
  id: string;
  text: string;
  client_created_at_ms: number;
  updated_at: string;
};

type TranscriptRow = {
  id: string;
  text: string;
  client_created_at_ms: number;
  updated_at: string;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [todosSortOrder, setTodosSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [observationsSortOrder, setObservationsSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [transcriptsSortOrder, setTranscriptsSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingType, setEditingType] = useState<'todo' | 'observation' | 'transcript' | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [focusedItemType, setFocusedItemType] = useState<'todo' | 'observation' | 'transcript' | null>(null);
  const [focusedSection, setFocusedSection] = useState<'todo' | 'observation' | 'transcript' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    // Load dark mode preference from localStorage
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });
  // Individual experimental feature flags
  const [experimentalClipboardHistory, setExperimentalClipboardHistory] = useState(() => {
    const saved = localStorage.getItem('experimentalClipboardHistory');
    return saved === 'true';
  });
  
  // Clipboard hotkey configuration
  const [clipboardHotkeys, setClipboardHotkeys] = useState<{ screenshot?: string; history?: string }>({
    screenshot: 'CommandOrControl+Shift+4',
    history: 'CommandOrControl+Shift+V',
  });
  const [isCapturingScreenshotHotkey, setIsCapturingScreenshotHotkey] = useState(false);
  const [isCapturingHistoryHotkey, setIsCapturingHistoryHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  
  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
    }
  }, []);
  
  // Helper function to convert Electron hotkey format to display format
  const formatHotkeyForDisplay = (hotkey: string): string => {
    return hotkey.replace(/CommandOrControl/g, '⌘').replace(/Command/g, '⌘').replace(/Control/g, '⌃').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧');
  };
  
  // Helper function to build hotkey string from keyboard event (uses physical key codes)
  const buildHotkeyString = (event: KeyboardEvent): string => {
    const parts: string[] = [];
    if (event.metaKey) parts.push('Command');
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Use physical key code to avoid locale-specific characters (e.g., Alt+¡)
    let key = event.code;

    if (key.startsWith('Key')) {
      key = key.substring(3).toUpperCase(); // KeyA -> A
    } else if (key.startsWith('Digit')) {
      key = key.substring(5); // Digit1 -> 1
    } else {
      const codeMap: Record<string, string> = {
        'Space': 'Space',
        'Backquote': '`',
        'Backslash': '\\',
        'BracketLeft': '[',
        'BracketRight': ']',
        'Comma': ',',
        'Equal': '=',
        'Minus': '-',
        'Period': '.',
        'Quote': "'",
        'Semicolon': ';',
        'Slash': '/',
        'CapsLock': 'CapsLock',
        'Escape': 'Escape',
        'Enter': 'Enter',
        'Tab': 'Tab',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'PageUp': 'PageUp',
        'PageDown': 'PageDown',
        'Home': 'Home',
        'End': 'End',
        'Insert': 'Insert',
        'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
        'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
        'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
      };
      if (codeMap[key]) {
        key = codeMap[key];
      } else {
        // Fallback only for single ASCII characters
        const fallback = event.key;
        if (fallback && fallback.length === 1 && fallback.charCodeAt(0) < 128) {
          key = fallback.toUpperCase();
        } else {
          console.warn(`[Hotkey] Unsupported key: ${event.code} (key: ${event.key})`);
          return '';
        }
      }
    }

    // If only a modifier was pressed, return empty to indicate invalid
    if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') {
      return '';
    }

    return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
  };

  // Utility: detect modifier-only strings
  const isModifierOnly = (s: string) => {
    return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
  };
  
  // Handler for setting screenshot hotkey
  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingScreenshotHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    // Guard invalid or modifier-only strings
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ screenshot: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, screenshot: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set screenshot hotkey');
      console.error('Failed to set screenshot hotkey:', err);
    }
  }, []);
  
  // Handler for setting history hotkey
  const handleSetHistoryHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingHistoryHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    // Guard invalid or modifier-only strings
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ history: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register history hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, history: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set history hotkey');
      console.error('Failed to set history hotkey:', err);
    }
  }, []);
  
  // Handler for keydown events when capturing screenshot hotkey
  useEffect(() => {
    if (!isCapturingScreenshotHotkey) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        handleSetScreenshotHotkey(hotkeyString);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCapturingScreenshotHotkey, handleSetScreenshotHotkey]);
  
  // Handler for keydown events when capturing history hotkey
  useEffect(() => {
    if (!isCapturingHistoryHotkey) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        handleSetHistoryHotkey(hotkeyString);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCapturingHistoryHotkey, handleSetHistoryHotkey]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const fetchLists = useCallback(async () => {
    if (!session) {
      setMessage('Sign in to fetch data.');
      return;
    }
    setIsRefreshing(true);
    setMessage(null);
    try {
      const [todosRes, obsRes, transcriptsRes] = await Promise.all([
        supabase.from('todos').select('*').order('client_created_at_ms', { ascending: false }),
        supabase.from('observations').select('*').order('client_created_at_ms', { ascending: false }),
        supabase.from('transcripts').select('*').order('client_created_at_ms', { ascending: false }),
      ]);

      if (todosRes.error) throw todosRes.error;
      if (obsRes.error) throw obsRes.error;
      if (transcriptsRes.error) throw transcriptsRes.error;

      const todosData = todosRes.data ?? [];
      const observationsData = obsRes.data ?? [];
      const transcriptsData = transcriptsRes.data ?? [];

      setTodos(todosData);
      setObservations(observationsData);
      setTranscripts(transcriptsData);
      saveToCache({ todos: todosData, observations: observationsData, transcripts: transcriptsData });
      setMessage('Lists refreshed.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to refresh lists.';
      setMessage(msg);
    } finally {
      setIsRefreshing(false);
    }
  }, [session]);

  // Load data from cache on mount, then sync in background
  useEffect(() => {
    const cached = loadFromCache();
    if (cached) {
      setTodos(cached.todos || []);
      setObservations(cached.observations || []);
      setTranscripts(cached.transcripts || []);
    }
    setIsInitialized(true);
    if (session) fetchLists(); // Background sync
  }, [session, fetchLists]);

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleSendOtp = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage('Enter an email first.');
      return;
    }
    setIsSending(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed.toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setMessage('Code sent. Check your inbox.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to send code.';
      setMessage(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedEmail = email.trim();
    const trimmedOtp = otp.trim();
    if (!trimmedEmail || !trimmedOtp) {
      setMessage('Provide email + code.');
      return;
    }
    setIsVerifying(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: trimmedEmail.toLowerCase(),
        token: trimmedOtp,
        type: 'email',
      });
      if (error) throw error;
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setOtp('');
      setMessage('Signed in.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to verify code.';
      setMessage(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(CACHE_KEY);
    setSession(null);
    setTodos([]);
    setObservations([]);
    setTranscripts([]);
  };

  // Copy functionality
  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500);
  };

  // Expand/collapse for transcripts
  const MAX_PREVIEW_LINES = 3;
  const handleToggleExpand = (id: string) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Todo completion toggle
  const handleToggleComplete = async (id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;

    const { error } = await supabase.from('todos').update({ completed: !todo.completed }).eq('id', id);

    if (!error) {
      const updatedTodos = todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
      setTodos(updatedTodos);
      // Update cache
      const cached = loadFromCache();
      if (cached) {
        saveToCache({ ...cached, todos: updatedTodos });
      }
    }
  };

  // Edit functionality
  const handleEdit = (item: TodoRow | ObservationRow | TranscriptRow, type: 'todo' | 'observation' | 'transcript') => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditingType(type);
  };

  const handleSave = async () => {
    if (!editText.trim() || !editingId || !editingType) return;

    if (editingType === 'todo') {
      const { error } = await supabase.from('todos').update({ text: editText.trim() }).eq('id', editingId);
      if (!error) {
        const updatedTodos = todos.map((t) => (t.id === editingId ? { ...t, text: editText.trim() } : t));
        setTodos(updatedTodos);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, todos: updatedTodos });
      }
    } else if (editingType === 'observation') {
      const { error } = await supabase.from('observations').update({ text: editText.trim() }).eq('id', editingId);
      if (!error) {
        const updatedObservations = observations.map((o) => (o.id === editingId ? { ...o, text: editText.trim() } : o));
        setObservations(updatedObservations);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, observations: updatedObservations });
      }
    } else if (editingType === 'transcript') {
      const { error } = await supabase.from('transcripts').update({ text: editText.trim() }).eq('id', editingId);
      if (!error) {
        const updatedTranscripts = transcripts.map((t) => (t.id === editingId ? { ...t, text: editText.trim() } : t));
        setTranscripts(updatedTranscripts);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, transcripts: updatedTranscripts });
      }
    }

    setEditingId(null);
    setEditText('');
    setEditingType(null);
  };

  // Delete functionality
  const handleDelete = async (id: string, type: 'todo' | 'observation' | 'transcript') => {
    if (!confirm(`Delete this ${type}?`)) return;

    const table = type === 'todo' ? 'todos' : type === 'observation' ? 'observations' : 'transcripts';
    const { error } = await supabase.from(table).delete().eq('id', id);

    if (!error) {
      if (type === 'todo') {
        const updatedTodos = todos.filter((t) => t.id !== id);
        setTodos(updatedTodos);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, todos: updatedTodos });
      } else if (type === 'observation') {
        const updatedObservations = observations.filter((o) => o.id !== id);
        setObservations(updatedObservations);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, observations: updatedObservations });
      } else {
        const updatedTranscripts = transcripts.filter((t) => t.id !== id);
        setTranscripts(updatedTranscripts);
        const cached = loadFromCache();
        if (cached) saveToCache({ ...cached, transcripts: updatedTranscripts });
      }
    }
  };

  // Sort and group data
  const sortedTodos = useMemo(() => sortTodos(todos, todosSortOrder), [todos, todosSortOrder]);
  const todosSections = useMemo(() => groupByDate(sortedTodos, todosSortOrder), [sortedTodos, todosSortOrder]);
  const observationsSections = useMemo(() => groupByDate(observations, observationsSortOrder), [observations, observationsSortOrder]);
  const transcriptsSections = useMemo(() => groupByDate(transcripts, transcriptsSortOrder), [transcripts, transcriptsSortOrder]);

  const summary = useMemo(() => {
    const totalTodos = todos.length;
    const completed = todos.filter((todo) => todo.completed).length;
    return `${completed}/${totalTodos} tasks complete`;
  }, [todos]);

  // Keyboard shortcuts handler
  useEffect(() => {
    if (!session) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if typing in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          setEditingId(null);
          setEditText('');
          setEditingType(null);
        }
        return;
      }

      // Show shortcuts modal
      if (e.key === '?' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // Close modals
      if (e.key === 'Escape') {
        if (showShortcuts) {
          e.preventDefault();
          setShowShortcuts(false);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
      }

      // Don't handle other shortcuts if modal is open
      if (showShortcuts || showSettings) return;

      // Tab/Shift+Tab: Move between sections (Tasks, Observations, Transcripts)
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const sections: Array<'todo' | 'observation' | 'transcript'> = ['todo', 'observation', 'transcript'];
        const currentSectionIndex = focusedSection !== null ? sections.indexOf(focusedSection) : -1;
        
        // Determine next section
        let nextSection: 'todo' | 'observation' | 'transcript';
        if (e.shiftKey) {
          // Shift+Tab: previous section
          if (currentSectionIndex === -1) {
            nextSection = sections[sections.length - 1];
          } else {
            nextSection = currentSectionIndex > 0 
              ? sections[currentSectionIndex - 1] 
              : sections[sections.length - 1];
          }
        } else {
          // Tab: next section
          if (currentSectionIndex === -1) {
            nextSection = sections[0];
          } else {
            nextSection = currentSectionIndex < sections.length - 1 
              ? sections[currentSectionIndex + 1] 
              : sections[0];
          }
        }

        // Find first item in the next section
        let firstItem: { id: string; type: 'todo' | 'observation' | 'transcript' } | null = null;
        if (nextSection === 'todo' && todosSections.length > 0 && todosSections[0].data.length > 0) {
          firstItem = { id: todosSections[0].data[0].id, type: 'todo' };
        } else if (nextSection === 'observation' && observationsSections.length > 0 && observationsSections[0].data.length > 0) {
          firstItem = { id: observationsSections[0].data[0].id, type: 'observation' };
        } else if (nextSection === 'transcript' && transcriptsSections.length > 0 && transcriptsSections[0].data.length > 0) {
          firstItem = { id: transcriptsSections[0].data[0].id, type: 'transcript' };
        }

        setFocusedSection(nextSection);
        if (firstItem) {
          setFocusedItemId(firstItem.id);
          setFocusedItemType(firstItem.type);
        } else {
          setFocusedItemId(null);
          setFocusedItemType(null);
        }
        return;
      }

      // Get all items in order for navigation
      const allItems: Array<{ id: string; type: 'todo' | 'observation' | 'transcript' }> = [];
      todosSections.forEach((section) => {
        section.data.forEach((item) => allItems.push({ id: item.id, type: 'todo' }));
      });
      observationsSections.forEach((section) => {
        section.data.forEach((item) => allItems.push({ id: item.id, type: 'observation' }));
      });
      transcriptsSections.forEach((section) => {
        section.data.forEach((item) => allItems.push({ id: item.id, type: 'transcript' }));
      });

      const currentIndex = focusedItemId ? allItems.findIndex((item) => item.id === focusedItemId) : -1;

      // Update focused section when navigating with j/k
      if (focusedItemId && focusedItemType) {
        setFocusedSection(focusedItemType);
      }

      // Navigation: j/k (Gmail style)
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (allItems.length === 0) return;
        const nextIndex = currentIndex < allItems.length - 1 ? currentIndex + 1 : 0;
        setFocusedItemId(allItems[nextIndex].id);
        setFocusedItemType(allItems[nextIndex].type);
      } else if (e.key === 'k' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (allItems.length === 0) return;
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : allItems.length - 1;
        setFocusedItemId(allItems[prevIndex].id);
        setFocusedItemType(allItems[prevIndex].type);
      }

      // Actions on focused item
      if (focusedItemId && focusedItemType) {
        // Enter: edit (todos/observations only)
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          if (focusedItemType === 'todo') {
            const todo = todos.find((t) => t.id === focusedItemId);
            if (todo) handleEdit(todo, 'todo');
          } else if (focusedItemType === 'observation') {
            const obs = observations.find((o) => o.id === focusedItemId);
            if (obs) handleEdit(obs, 'observation');
          }
        }

        // x: toggle complete (todos only)
        if (e.key === 'x' && !e.metaKey && !e.ctrlKey && !e.altKey && focusedItemType === 'todo') {
          e.preventDefault();
          handleToggleComplete(focusedItemId);
        }

        // # or Delete: delete
        if ((e.key === '#' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          if (confirm(`Delete this ${focusedItemType}?`)) {
            handleDelete(focusedItemId, focusedItemType);
            // Move focus to next item
            const nextIndex = currentIndex < allItems.length - 1 ? currentIndex + 1 : currentIndex > 0 ? currentIndex - 1 : -1;
            if (nextIndex >= 0) {
              setFocusedItemId(allItems[nextIndex].id);
              setFocusedItemType(allItems[nextIndex].type);
            } else {
              setFocusedItemId(null);
              setFocusedItemType(null);
            }
          }
        }

        // c: copy
        if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          let text = '';
          if (focusedItemType === 'todo') {
            const todo = todos.find((t) => t.id === focusedItemId);
            text = todo?.text || '';
          } else if (focusedItemType === 'observation') {
            const obs = observations.find((o) => o.id === focusedItemId);
            text = obs?.text || '';
          } else if (focusedItemType === 'transcript') {
            const transcript = transcripts.find((t) => t.id === focusedItemId);
            text = transcript?.text || '';
          }
          if (text) handleCopy(text, focusedItemId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    session,
    focusedItemId,
    focusedItemType,
    focusedSection,
    showShortcuts,
    showSettings,
    todosSections,
    observationsSections,
    transcriptsSections,
    todos,
    observations,
    transcripts,
    handleToggleComplete,
    handleEdit,
    handleDelete,
    handleCopy,
  ]);

  // Loading state
  if (!isInitialized) {
    return (
      <div style={styles.root}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .list-item-wrapper .item-actions {
          opacity: 0;
          transition: opacity 0.2s;
        }
        .list-item-wrapper:hover .item-actions,
        .list-item-wrapper.focused .item-actions {
          opacity: 1;
        }
        .item-actions button {
          transition: background-color 0.2s;
        }
        .item-actions button:hover {
          background-color: ${darkMode ? '#404040' : '#f3f4f6'} !important;
        }
        .delete-button:hover {
          background-color: #fee2e2 !important;
        }
        input[type="checkbox"] {
          accent-color: ${darkMode ? '#9ca3af' : '#3b82f6'};
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
      `}</style>
      {/* Draggable region for window movement */}
      <div style={styles.draggableRegion}></div>
      <div 
        style={{
          ...styles.root,
          backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
          color: darkMode ? '#e5e5e5' : '#111',
        }}
        onClick={(e) => {
          // Clear focus when clicking on empty space (but not on interactive elements or list items)
          const target = e.target as HTMLElement;
          // Only clear if not clicking on buttons, inputs, textareas, or list items
          if (!target.closest('button') && !target.closest('input') && !target.closest('textarea') && !target.closest('li') && !target.closest('section')) {
            setFocusedItemId(null);
            setFocusedItemType(null);
            setFocusedSection(null);
          }
        }}
      >
      <div style={styles.dataTabContent}>

      {session ? (
        <div style={styles.listsContainer}>
          {/* Tasks Section */}
          <section style={{
            ...styles.listSection,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
            borderColor: darkMode ? '#404040' : 'transparent',
          }}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 400,
                color: darkMode ? '#e5e5e5' : '#111',
              }}>Tasks</h2>
              <button
                style={{
                  ...styles.sortButton,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                  backgroundColor: darkMode ? '#2d2d2d' : '#f9fafb',
                  borderColor: darkMode ? '#404040' : '#e5e7eb',
                }}
                onClick={() => setTodosSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              >
                {todosSortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
            {todosSections.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={{
                  ...styles.emptyTitle,
                  color: darkMode ? '#e5e5e5' : '#111',
                }}>No tasks yet</p>
                <p style={{
                  ...styles.emptySubtitle,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                }}>Pull down to record</p>
              </div>
            ) : (
              todosSections.map((section) => (
                <div key={section.key}>
                  <h3 style={{
                    ...styles.sectionHeader,
                    color: darkMode ? '#9ca3af' : '#6b7280',
                    borderBottomColor: darkMode ? '#404040' : '#e5e7eb',
                  }}>{section.title}</h3>
                  <ul>
                    {section.data.map((todo) => (
                      <li
                        key={todo.id}
                        className={`list-item-wrapper ${focusedItemId === todo.id && focusedItemType === 'todo' ? 'focused' : ''}`}
                        style={{
                          ...styles.listItem,
                          backgroundColor: darkMode ? '#1a1a1a' : 'transparent',
                          borderColor: darkMode ? '#404040' : '#e5e7eb',
                          color: darkMode ? '#e5e5e5' : '#111',
                          ...(focusedItemId === todo.id && focusedItemType === 'todo' ? {
                            ...styles.focusedItem,
                            backgroundColor: darkMode ? '#2d2d2d' : '#f3f4f6',
                            borderColor: darkMode ? '#555' : '#d1d5db',
                          } : {}),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedItemId(todo.id);
                          setFocusedItemType('todo');
                          setFocusedSection('todo');
                        }}
                      >
                        <div style={styles.todoItem}>
                          <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleComplete(todo.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={styles.checkbox}
                          />
                          <div style={styles.itemContent}>
                            <div style={styles.itemHeader}>
                              <strong
                                style={{
                                  ...styles.itemText,
                                  ...(todo.completed ? styles.itemTextCompleted : {}),
                                  color: darkMode ? (todo.completed ? '#9ca3af' : '#e5e5e5') : (todo.completed ? '#6b7280' : '#111'),
                                }}
                              >
                                {todo.text}
                              </strong>
                              <div className="item-actions" style={styles.itemActions}>
                                <button
                                  style={styles.actionButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy(todo.text, todo.id);
                                  }}
                                >
                                  {copiedId === todo.id ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                  style={styles.actionButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(todo, 'todo');
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="delete-button"
                                  style={styles.deleteButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(todo.id, 'todo');
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <div style={{
                              ...styles.metaRow,
                              color: darkMode ? '#9ca3af' : '#6b7280',
                            }}>
                              {formatTime(todo.client_created_at_ms)}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          {/* Observations Section */}
          <section style={{
            ...styles.listSection,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
            borderColor: darkMode ? '#404040' : 'transparent',
          }}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 400,
                color: darkMode ? '#e5e5e5' : '#111',
              }}>Observations</h2>
              <button
                style={{
                  ...styles.sortButton,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                  backgroundColor: darkMode ? '#2d2d2d' : '#f9fafb',
                  borderColor: darkMode ? '#404040' : '#e5e7eb',
                }}
                onClick={() => setObservationsSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              >
                {observationsSortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
            {observationsSections.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={{
                  ...styles.emptyTitle,
                  color: darkMode ? '#e5e5e5' : '#111',
                }}>No observations yet</p>
                <p style={{
                  ...styles.emptySubtitle,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                }}>Pull down to record</p>
              </div>
            ) : (
              observationsSections.map((section) => (
                <div key={section.key}>
                  <h3 style={{
                    ...styles.sectionHeader,
                    color: darkMode ? '#9ca3af' : '#6b7280',
                    borderBottomColor: darkMode ? '#404040' : '#e5e7eb',
                  }}>{section.title}</h3>
                  <ul>
                    {section.data.map((observation) => (
                      <li
                        key={observation.id}
                        className={`list-item-wrapper ${focusedItemId === observation.id && focusedItemType === 'observation' ? 'focused' : ''}`}
                        style={{
                          ...styles.listItem,
                          backgroundColor: darkMode ? '#1a1a1a' : 'transparent',
                          borderColor: darkMode ? '#404040' : '#e5e7eb',
                          color: darkMode ? '#e5e5e5' : '#111',
                          ...(focusedItemId === observation.id && focusedItemType === 'observation' ? {
                            ...styles.focusedItem,
                            backgroundColor: darkMode ? '#2d2d2d' : '#f3f4f6',
                            borderColor: darkMode ? '#555' : '#d1d5db',
                          } : {}),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedItemId(observation.id);
                          setFocusedItemType('observation');
                          setFocusedSection('observation');
                        }}
                      >
                        <div style={styles.itemContent}>
                          <div style={styles.itemHeader}>
                            <strong style={{
                              ...styles.itemText,
                              color: darkMode ? '#e5e5e5' : '#111',
                            }}>{observation.text}</strong>
                            <div className="item-actions" style={styles.itemActions}>
                              <button
                                style={styles.actionButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(observation.text, observation.id);
                                }}
                              >
                                {copiedId === observation.id ? 'Copied' : 'Copy'}
                              </button>
                              <button
                                style={styles.actionButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEdit(observation, 'observation');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="delete-button"
                                style={styles.deleteButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(observation.id, 'observation');
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div style={{
                            ...styles.metaRow,
                            color: darkMode ? '#9ca3af' : '#6b7280',
                          }}>{formatTime(observation.client_created_at_ms)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          {/* Transcripts Section */}
          <section style={{
            ...styles.listSection,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
            borderColor: darkMode ? '#404040' : 'transparent',
          }}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 400,
                color: darkMode ? '#e5e5e5' : '#111',
              }}>Transcripts</h2>
              <button
                style={{
                  ...styles.sortButton,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                  backgroundColor: darkMode ? '#2d2d2d' : '#f9fafb',
                  borderColor: darkMode ? '#404040' : '#e5e7eb',
                }}
                onClick={() => setTranscriptsSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              >
                {transcriptsSortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
            {transcriptsSections.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={{
                  ...styles.emptyTitle,
                  color: darkMode ? '#e5e5e5' : '#111',
                }}>No transcripts yet</p>
                <p style={{
                  ...styles.emptySubtitle,
                  color: darkMode ? '#9ca3af' : '#6b7280',
                }}>Tap "Record" to capture the first note</p>
              </div>
            ) : (
              transcriptsSections.map((section) => (
                <div key={section.key}>
                  <h3 style={{
                    ...styles.sectionHeader,
                    color: darkMode ? '#9ca3af' : '#6b7280',
                    borderBottomColor: darkMode ? '#404040' : '#e5e7eb',
                  }}>{section.title}</h3>
                  <ul>
                    {section.data.map((transcript) => {
                      const isExpanded = Boolean(expandedMap[transcript.id]);
                      const shouldShowExpand = transcript.text.length > 160 || transcript.text.includes('\n');
                      return (
                        <li
                          key={transcript.id}
                          className={`list-item-wrapper ${focusedItemId === transcript.id && focusedItemType === 'transcript' ? 'focused' : ''}`}
                          style={{
                            ...styles.listItem,
                            backgroundColor: darkMode ? '#1a1a1a' : 'transparent',
                            borderColor: darkMode ? '#404040' : '#e5e7eb',
                            color: darkMode ? '#e5e5e5' : '#111',
                            ...(focusedItemId === transcript.id && focusedItemType === 'transcript' ? {
                              ...styles.focusedItem,
                              backgroundColor: darkMode ? '#2d2d2d' : '#f3f4f6',
                              borderColor: darkMode ? '#555' : '#d1d5db',
                            } : {}),
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusedItemId(transcript.id);
                            setFocusedItemType('transcript');
                            setFocusedSection('transcript');
                          }}
                        >
                          <div style={styles.itemContent}>
                            <div style={styles.itemHeader}>
                              <p
                                style={{
                                  ...styles.itemText,
                                  margin: '0 0 4px',
                                  display: '-webkit-box',
                                  WebkitLineClamp: isExpanded ? undefined : MAX_PREVIEW_LINES,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  color: darkMode ? '#e5e5e5' : '#111',
                                }}
                              >
                                {transcript.text}
                              </p>
                              <div className="item-actions" style={styles.itemActions}>
                                <button
                                  style={styles.actionButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy(transcript.text, transcript.id);
                                  }}
                                >
                                  {copiedId === transcript.id ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                  style={styles.actionButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(transcript, 'transcript');
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="delete-button"
                                  style={styles.deleteButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(transcript.id, 'transcript');
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            {shouldShowExpand && (
                              <button
                                style={styles.expandButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleExpand(transcript.id);
                                }}
                              >
                                {isExpanded ? 'Show less' : 'Expand'}
                              </button>
                            )}
                            <div style={{
                              ...styles.metaRow,
                              color: darkMode ? '#9ca3af' : '#6b7280',
                            }}>{formatTime(transcript.client_created_at_ms)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </section>
        </div>
      ) : (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          width: '100%',
          minHeight: '400px',
        }}>
          <div style={{ 
            textAlign: 'center', 
            maxWidth: '480px', 
            padding: '32px',
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            borderRadius: '12px',
            boxShadow: darkMode ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(15, 23, 42, 0.08)',
          }}>
            <h2 style={{ 
              marginTop: 0, 
              marginBottom: '12px',
              color: darkMode ? '#e5e5e5' : '#111',
              fontSize: '24px',
              fontWeight: 600,
            }}>
              Welcome to Little One
            </h2>
            <p style={{ 
              color: darkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '24px',
              fontSize: '14px',
              lineHeight: '1.6',
            }}>
              Sign in to view tasks, observations, and transcripts. Use the settings button to get started.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                style={{ 
                  ...styles.primaryButton, 
                  width: 'auto',
                  padding: '10px 20px',
                }}
                onClick={() => setShowSettings(true)}
              >
                Open Settings
              </button>
              <button
                style={{ 
                  ...styles.secondaryButton, 
                  width: 'auto',
                  padding: '10px 20px',
                }}
                onClick={() => {
                  const newDarkMode = !darkMode;
                  setDarkMode(newDarkMode);
                  localStorage.setItem('darkMode', String(newDarkMode));
                }}
              >
                {darkMode ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingId && editingType && (
        <div style={styles.modalOverlay}>
          <div style={{
            ...styles.modalContent,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
          }}>
            <h3 style={styles.modalTitle}>Edit {editingType === 'todo' ? 'Task' : editingType === 'observation' ? 'Observation' : 'Transcript'}</h3>
            <textarea
              style={styles.modalInput}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
            />
            <div style={styles.modalButtons}>
              <button style={styles.secondaryButton} onClick={() => { setEditingId(null); setEditText(''); setEditingType(null); }}>
                Cancel
              </button>
              <button style={styles.primaryButton} onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shortcuts and Settings Buttons */}
      <div style={styles.bottomButtons}>
        {session && (
          <button style={{
            ...styles.shortcutsButton,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#6b7280',
            borderColor: darkMode ? '#404040' : '#e5e7eb',
          }} onClick={() => setShowShortcuts(true)}>
            Keyboard Shortcuts (?)
          </button>
        )}
        <button
          style={{
            ...styles.settingsButton,
            backgroundColor: darkMode ? '#374151' : '#fff',
            color: darkMode ? '#fff' : '#6b7280',
            borderColor: darkMode ? '#374151' : '#e5e7eb',
          }}
          onClick={() => {
            const newDarkMode = !darkMode;
            setDarkMode(newDarkMode);
            localStorage.setItem('darkMode', String(newDarkMode));
          }}
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
        <button style={{
          ...styles.settingsButton,
          backgroundColor: darkMode ? '#2d2d2d' : '#fff',
          color: darkMode ? '#e5e5e5' : '#6b7280',
          borderColor: darkMode ? '#404040' : '#e5e7eb',
        }} onClick={() => setShowSettings(true)}>
          ⚙️
        </button>
      </div>

      {/* Shortcuts Modal */}
      {showShortcuts && (
        <div style={styles.shortcutsModal} onClick={() => setShowShortcuts(false)}>
          <div style={{
            ...styles.shortcutsContent,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.shortcutsTitle}>Keyboard Shortcuts</h2>

            <div style={styles.shortcutsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Navigation</h3>
              <div style={styles.shortcutsRow}>
                <span>Move between sections (Tasks/Observations/Transcripts)</span>
                <span style={styles.shortcutsKey}>Tab</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Move between sections (reverse)</span>
                <span style={styles.shortcutsKey}>Shift+Tab</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Move down</span>
                <span style={styles.shortcutsKey}>j</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Move up</span>
                <span style={styles.shortcutsKey}>k</span>
              </div>
            </div>

            <div style={styles.shortcutsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Actions</h3>
              <div style={styles.shortcutsRow}>
                <span>Edit item (tasks/observations)</span>
                <span style={styles.shortcutsKey}>Enter</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Toggle complete (tasks)</span>
                <span style={styles.shortcutsKey}>x</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Copy text</span>
                <span style={styles.shortcutsKey}>c</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Delete item</span>
                <span style={styles.shortcutsKey}>#</span>
              </div>
            </div>

            <div style={styles.shortcutsSection}>
              <h3 style={styles.shortcutsSectionTitle}>General</h3>
              <div style={styles.shortcutsRow}>
                <span>Show shortcuts</span>
                <span style={styles.shortcutsKey}>?</span>
              </div>
              <div style={styles.shortcutsRow}>
                <span>Close modal</span>
                <span style={styles.shortcutsKey}>Esc</span>
              </div>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button style={styles.secondaryButton} onClick={() => setShowShortcuts(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={styles.shortcutsModal} onClick={() => setShowSettings(false)}>
          <div style={{
            ...styles.settingsContent,
            backgroundColor: darkMode ? '#2d2d2d' : '#fff',
            color: darkMode ? '#e5e5e5' : '#111',
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.shortcutsTitle}>Settings</h2>

            <div style={styles.settingsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Audio</h3>
              <AudioSettingsPanel />
            </div>

            <div style={styles.settingsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Transcription</h3>
              <TranscriptionSettings />
            </div>

            <div style={styles.settingsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Experimental Features</h3>
              <p style={{
                fontSize: '13px',
                color: darkMode ? '#9ca3af' : '#6b7280',
                marginBottom: '16px',
                marginTop: '4px',
              }}>
                Features that are still in development. These may be unstable or incomplete. Enable individual features below.
              </p>
              
              <div style={styles.experimentalSection}>
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: darkMode ? '#e5e5e5' : '#374151',
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: darkMode ? '#1a1a1a' : '#f9fafb',
                  border: `1px solid ${darkMode ? '#404040' : '#e5e7eb'}`,
                  marginBottom: '12px',
                }}>
                  <input
                    type="checkbox"
                    checked={experimentalClipboardHistory}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setExperimentalClipboardHistory(enabled);
                      localStorage.setItem('experimentalClipboardHistory', String(enabled));
                    }}
                    style={{
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer',
                      accentColor: darkMode ? '#3b82f6' : '#2563eb',
                      marginTop: '2px',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                      Clipboard History
                    </div>
                    <div style={{ fontSize: '12px', color: darkMode ? '#9ca3af' : '#6b7280', lineHeight: '1.5' }}>
                      Alfred-style clipboard history popup with fuzzy search and multi-select. Access via hotkey or by calling the API. Shows text, images, transcripts, and screenshots from your clipboard.
                    </div>
                  </div>
                </label>
                
                {/* Hotkey Configuration */}
                {experimentalClipboardHistory && (
                  <div style={{
                    marginTop: '16px',
                    padding: '16px',
                    borderRadius: '8px',
                    backgroundColor: darkMode ? '#1a1a1a' : '#f9fafb',
                    border: `1px solid ${darkMode ? '#404040' : '#e5e7eb'}`,
                  }}>
                    <h4 style={{
                      marginTop: 0,
                      marginBottom: '12px',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: darkMode ? '#e5e5e5' : '#374151',
                    }}>
                      Hotkey Configuration
                    </h4>
                    
                    {/* Screenshot Hotkey */}
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{
                        display: 'block',
                        marginBottom: '6px',
                        fontSize: '13px',
                        color: darkMode ? '#d1d5db' : '#6b7280',
                      }}>
                        Screenshot Hotkey
                      </label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          onClick={() => {
                            setIsCapturingScreenshotHotkey(true);
                            setHotkeyError(null);
                          }}
                          disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: isCapturingScreenshotHotkey ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                            backgroundColor: isCapturingScreenshotHotkey ? '#3b82f6' : (darkMode ? '#2d2d2d' : '#fff'),
                            border: `1px solid ${darkMode ? '#404040' : '#d1d5db'}`,
                            borderRadius: '6px',
                            cursor: isCapturingScreenshotHotkey || isCapturingHistoryHotkey ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isCapturingScreenshotHotkey ? 'Press key combination...' : `Change (${clipboardHotkeys.screenshot || 'Not set'})`}
                        </button>
                        {isCapturingScreenshotHotkey && (
                          <button
                            onClick={() => {
                              setIsCapturingScreenshotHotkey(false);
                              setHotkeyError(null);
                            }}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              color: darkMode ? '#9ca3af' : '#6b7280',
                              backgroundColor: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* History Hotkey */}
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{
                        display: 'block',
                        marginBottom: '6px',
                        fontSize: '13px',
                        color: darkMode ? '#d1d5db' : '#6b7280',
                      }}>
                        History Hotkey
                      </label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          onClick={() => {
                            setIsCapturingHistoryHotkey(true);
                            setHotkeyError(null);
                          }}
                          disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: isCapturingHistoryHotkey ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                            backgroundColor: isCapturingHistoryHotkey ? '#3b82f6' : (darkMode ? '#2d2d2d' : '#fff'),
                            border: `1px solid ${darkMode ? '#404040' : '#d1d5db'}`,
                            borderRadius: '6px',
                            cursor: isCapturingScreenshotHotkey || isCapturingHistoryHotkey ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isCapturingHistoryHotkey ? 'Press key combination...' : `Change (${clipboardHotkeys.history || 'Not set'})`}
                        </button>
                        {isCapturingHistoryHotkey && (
                          <button
                            onClick={() => {
                              setIsCapturingHistoryHotkey(false);
                              setHotkeyError(null);
                            }}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              color: darkMode ? '#9ca3af' : '#6b7280',
                              backgroundColor: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {hotkeyError && (
                      <p style={{
                        marginTop: '8px',
                        fontSize: '12px',
                        color: '#ef4444',
                      }}>
                        {hotkeyError}
                      </p>
                    )}
                    
                    <p style={{
                      marginTop: '12px',
                      marginBottom: 0,
                      fontSize: '11px',
                      color: darkMode ? '#9ca3af' : '#6b7280',
                      lineHeight: '1.5',
                    }}>
                      Supports 2-3 modifier keys + primary key (e.g., Command+Shift+Control+Space). Screenshot hotkey captures selected area and adds to prompt stack.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div style={styles.settingsSection}>
              <h3 style={styles.shortcutsSectionTitle}>Account</h3>
              {session ? (
                <>
                  <p style={styles.accountText}>Signed in as {session.user.email}</p>
                  <div style={styles.accountActions}>
                    <button 
                      style={styles.primaryButton} 
                      onClick={fetchLists} 
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? 'Refreshing…' : 'Refresh Lists'}
                    </button>
                    <button 
                      style={styles.secondaryButton} 
                      onClick={handleSignOut}
                    >
                      Sign Out
                    </button>
                  </div>
                  {message && <p style={styles.message}>{message}</p>}
                </>
              ) : (
                <>
                  <p style={styles.accountText}>Not signed in</p>
                  <label style={styles.label}>
                    Email
                    <input
                      style={styles.input}
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <button 
                    style={styles.primaryButton} 
                    onClick={handleSendOtp} 
                    disabled={isSending}
                  >
                    {isSending ? 'Sending…' : 'Send Code'}
                  </button>
                  <label style={styles.label}>
                    Code
                    <input
                      style={styles.input}
                      type="text"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                    />
                  </label>
                  <button 
                    style={styles.primaryButton} 
                    onClick={handleVerifyOtp} 
                    disabled={isVerifying}
                  >
                    {isVerifying ? 'Verifying…' : 'Verify & Sign In'}
                  </button>
                  {message && <p style={styles.message}>{message}</p>}
                </>
              )}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button style={styles.secondaryButton} onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logged in indicator - bottom right */}
      {session && (
        <div style={{
          ...styles.loggedInIndicator,
          backgroundColor: darkMode ? '#2d2d2d' : '#fff',
          color: darkMode ? '#e5e5e5' : '#6b7280',
          borderColor: darkMode ? '#404040' : '#e5e7eb',
        }}>
          Logged in
        </div>
      )}

      {/* Experimental features - Clipboard History is now in its own window */}
      </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  draggableRegion: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '44px', // Standard macOS title bar height
    WebkitAppRegion: 'drag' as any,
    zIndex: 1000,
    pointerEvents: 'auto',
  },
  root: {
    minHeight: '100vh',
    padding: '20px',
    paddingTop: '64px', // Add padding to account for draggable region
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'flex-start',
    backgroundColor: '#f5f5f5',
    width: '100%',
    boxSizing: 'border-box',
    overflowX: 'hidden', // Prevent horizontal scroll
  },
  tabBar: {
    display: 'flex',
    gap: '6px',
    marginBottom: '4px',
  },
  tabButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  tabButtonActive: {
    backgroundColor: '#111827',
    color: '#fff',
    borderColor: '#111827',
  },
  tabContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.08)',
  },
  dataTabContent: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
    width: '100%',
    boxSizing: 'border-box',
    minWidth: 0, // Allow flex children to shrink below content size
  },
  card: {
    width: '280px',
    padding: '16px',
    borderRadius: '12px',
    backgroundColor: '#fff',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.08)',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
    marginTop: '12px',
  },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '13px',
  },
  primaryButton: {
    width: '100%',
    marginTop: '12px',
    padding: '8px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#111827',
    color: '#fff',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    marginTop: '6px',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    color: '#111827',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
  },
  message: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#374151',
  },
  listsContainer: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
    gap: '12px',
    width: '100%',
  },
  listSection: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    padding: '12px',
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
    maxHeight: 'calc(100vh - 200px)', // More responsive than fixed 80vh
    minHeight: '200px', // Ensure minimum usable height
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  listItem: {
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    marginBottom: '6px',
    listStyle: 'none',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'flex-end', // Right-align time (bottom right)
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '4px',
  },
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  sortButton: {
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  sectionHeader: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: '12px',
    marginBottom: '6px',
    paddingBottom: '3px',
    borderBottom: '1px solid #e5e7eb',
  },
  emptyState: {
    padding: '24px',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: '15px',
    fontWeight: 400,
    color: '#111',
    marginBottom: '6px',
  },
  emptySubtitle: {
    fontSize: '13px',
    color: '#6b7280',
  },
  todoItem: {
    display: 'flex',
    gap: '6px',
    alignItems: 'flex-start',
  },
  checkbox: {
    marginTop: '3px',
    cursor: 'pointer',
    width: '16px',
    height: '16px',
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '6px',
    marginBottom: '2px',
    flexWrap: 'wrap', // Allow buttons to wrap on narrow screens
  },
  itemText: {
    flex: '1 1 auto', // Allow text to grow and shrink, but maintain auto basis
    fontSize: '14px',
    fontWeight: 400,
    color: '#111',
    lineHeight: '20px',
    minWidth: 0,
    maxWidth: '100%', // Prevent text from exceeding container width
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
  },
  itemTextCompleted: {
    textDecoration: 'line-through',
    color: '#6b7280',
  },
  itemActions: {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
    flexWrap: 'wrap', // Allow buttons to wrap if needed
    marginLeft: 'auto', // Push buttons to the right when wrapping
  },
  actionButton: {
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 400,
    color: '#dc2626',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  expandButton: {
    marginTop: '4px',
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 400,
    color: '#4338ca',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  focusedItem: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  bottomButtons: {
    position: 'fixed',
    bottom: '16px',
    left: '16px',
    display: 'flex',
    gap: '8px',
    zIndex: 100,
  },
  shortcutsButton: {
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  settingsButton: {
    padding: '6px 10px',
    fontSize: '14px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  shortcutsModal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1001,
  },
  shortcutsContent: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    padding: '20px',
    width: '90%',
    maxWidth: '600px',
    minWidth: 'min(320px, 90vw)', // Ensure minimum width on small screens
    maxHeight: 'min(80vh, 600px)', // Better height constraint
    overflow: 'auto',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
  },
  settingsContent: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    padding: '20px',
    width: '90%',
    maxWidth: '800px',
    minWidth: 'min(320px, 90vw)', // Ensure minimum width on small screens
    maxHeight: 'min(80vh, 700px)', // Better height constraint
    overflow: 'auto',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
  },
  settingsSection: {
    marginBottom: '32px',
  },
  shortcutsTitle: {
    fontSize: '18px',
    fontWeight: 400,
    marginBottom: '16px',
    color: '#111',
  },
  shortcutsSection: {
    marginBottom: '20px',
  },
  shortcutsSectionTitle: {
    fontSize: '13px',
    fontWeight: 400,
    color: '#374151',
    marginBottom: '8px',
  },
  shortcutsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    fontSize: '13px',
    color: '#6b7280',
  },
  shortcutsKey: {
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontFamily: 'monospace',
    minWidth: '24px',
    textAlign: 'center',
  },
  loggedInIndicator: {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    zIndex: 100,
  },
  experimentalSection: {
    marginTop: '8px',
  },
  accountText: {
    fontSize: '14px',
    color: '#374151',
    marginBottom: '12px',
  },
  accountActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    padding: '16px',
    width: '90%',
    maxWidth: '480px',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
  },
  modalTitle: {
    fontSize: '16px',
    fontWeight: 400,
    marginBottom: '12px',
    color: '#111',
  },
  modalInput: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    marginBottom: '12px',
    resize: 'vertical',
    minHeight: '80px',
  },
  modalButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '6px',
  },
};
