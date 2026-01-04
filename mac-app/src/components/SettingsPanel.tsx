// =============================================================================
// SettingsPanel - Consolidated settings UI for the clipboard history window.
// Shows audio, transcription, and clipboard settings in one view.
// Styled consistently with the clipboard history window's design language.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import AudioSettingsPanel from './AudioSettingsPanel';
import TranscriptionSettings from './TranscriptionSettings';
import PromptSettings from './PromptSettings';
import { supabase } from '../supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { useTheme } from '../contexts/ThemeContext';

/**
 * SettingsPanel - Settings content designed to live inside the clipboard history window.
 * Keeps the same functionality as the original App.tsx settings, but styled for the
 * clipboard history context.
 */
export default function SettingsPanel() {
  const { theme } = useTheme();
  // Permissions state
  const [permissions, setPermissions] = useState<{ accessibilityGranted: boolean } | null>(null);
  const [showPermissionsGate, setShowPermissionsGate] = useState(false);
  
  // Clipboard hotkey configuration
  const [clipboardHotkeys, setClipboardHotkeys] = useState<{ screenshot?: string; history?: string; desktopScreenshot?: string }>({
    screenshot: 'CommandOrControl+Shift+4',
    history: 'CommandOrControl+Shift+V',
    desktopScreenshot: 'Command+3',
  });
  const [isCapturingScreenshotHotkey, setIsCapturingScreenshotHotkey] = useState(false);
  const [isCapturingHistoryHotkey, setIsCapturingHistoryHotkey] = useState(false);
  const [isCapturingDesktopScreenshotHotkey, setIsCapturingDesktopScreenshotHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  
  // Continuous Context configuration
  const [continuousContextEnabled, setContinuousContextEnabled] = useState(false);
  const [continuousContextHotkey, setContinuousContextHotkey] = useState('Shift+Command+4');
  const [isCapturingContinuousContextHotkey, setIsCapturingContinuousContextHotkey] = useState(false);
  
  // Todo hotkey configuration
  const [todoHotkey, setTodoHotkey] = useState('Command+Shift+T');
  const [isCapturingTodoHotkey, setIsCapturingTodoHotkey] = useState(false);
  
  // Transcription hotkey configuration
  const [transcriptionHotkey, setTranscriptionHotkey] = useState('Command+\\');
  const [isCapturingTranscriptionHotkey, setIsCapturingTranscriptionHotkey] = useState(false);
  
  // Abandon recording hotkey configuration
  const [abandonHotkey, setAbandonHotkey] = useState('Escape');
  const [isCapturingAbandonHotkey, setIsCapturingAbandonHotkey] = useState(false);
  const [abandonConfirmation, setAbandonConfirmation] = useState(true);
  
  // Mobile sync state - sign-in is handled via TeamView, we just listen for session.
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // API key state - for Engineer feature (Anthropic API)
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Permission banner state - whether to show reminders for missing permissions.
  const [showPermissionReminders, setShowPermissionReminders] = useState(true);
  
  // Cursor status indicator - shows dot next to cursor during recording/transcribing.
  const [cursorStatusEnabled, setCursorStatusEnabled] = useState(true);
  
  // Hide status labels - show only colored dots.
  const [hideStatusLabels, setHideStatusLabels] = useState(false);
  
  // Sounds enabled - master toggle for all sounds.
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  
  // Tasks tab - experimental feature.
  const [tasksTabEnabled, setTasksTabEnabled] = useState(false);
  
  // Subscription tier state - 'free' or 'pro'.
  const [userTier, setUserTier] = useState<'free' | 'pro'>('free');
  
  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
      
      // Load continuous context settings
      window.clipboardAPI.getContinuousContextEnabled?.().then(enabled => {
        setContinuousContextEnabled(enabled);
      });
      window.clipboardAPI.getContinuousContextHotkey?.().then(hotkey => {
        if (hotkey) {
          setContinuousContextHotkey(hotkey);
        }
      });
      
      // Load API key status
      window.clipboardAPI.getApiKeyStatus?.().then(status => {
        setHasApiKey(status.hasKey);
      });
      
      // Load permission banner setting
      window.clipboardAPI.getHideScreenRecordingBanner?.().then(hide => {
        setShowPermissionReminders(!hide);
      });
      
      // Load cursor status indicator setting
      window.clipboardAPI.getCursorStatusEnabled?.().then(enabled => {
        setCursorStatusEnabled(enabled);
      });
      
      // Load hide status labels setting
      window.clipboardAPI.getHideStatusLabels?.().then(hide => {
        setHideStatusLabels(hide);
      });
      
      // Load sounds enabled setting
      window.clipboardAPI.getSoundsEnabled?.().then(enabled => {
        setSoundsEnabled(enabled);
      });
      
      // Load tasks tab enabled setting
      window.clipboardAPI.getTasksTabEnabled?.().then(enabled => {
        setTasksTabEnabled(enabled);
      });
    }
    
    // Load todo hotkey
    if (window.todoAPI) {
      window.todoAPI.getHotkey().then(hotkey => {
        if (hotkey) {
          setTodoHotkey(hotkey);
        }
      });
    }
    
    // Load transcription hotkeys
    if (window.transcribeAPI) {
      window.transcribeAPI.getHotkey().then(hotkey => {
        if (hotkey) {
          setTranscriptionHotkey(hotkey);
        }
      });
      window.transcribeAPI.getAbandonHotkey?.().then(hotkey => {
        if (hotkey) {
          setAbandonHotkey(hotkey);
        }
      });
      window.transcribeAPI.getAbandonConfirmation?.().then(enabled => {
        setAbandonConfirmation(enabled);
      });
    }
    
    // Load user tier from quota manager.
    if (window.quotaAPI?.getQuotas) {
      window.quotaAPI.getQuotas().then(quotas => {
        if (quotas) {
          setUserTier(quotas.tier);
        }
      });
    }
    
    // Listen for tier changes (e.g., after Stripe checkout).
    let unsubscribeTier: (() => void) | undefined;
    if (window.quotaAPI?.onTierChanged) {
      unsubscribeTier = window.quotaAPI.onTierChanged((tier) => {
        setUserTier(tier);
      });
    }
    
    return () => {
      unsubscribeTier?.();
    };
  }, []);
  
  // Handler for saving API key
  const handleSaveApiKey = async () => {
    if (!window.clipboardAPI?.setApiKey || !apiKeyInput.trim()) return;
    
    setApiKeySaving(true);
    setApiKeyError(null);
    
    try {
      const result = await window.clipboardAPI.setApiKey(apiKeyInput.trim());
      if (result.success) {
        setHasApiKey(true);
        setApiKeyInput('');
        setShowApiKey(false);
      } else {
        setApiKeyError(result.error || 'Failed to save API key');
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setApiKeySaving(false);
    }
  };
  
  // Handler for clearing API key
  const handleClearApiKey = async () => {
    if (!window.clipboardAPI?.clearApiKey) return;
    
    try {
      const result = await window.clipboardAPI.clearApiKey();
      if (result.success) {
        setHasApiKey(false);
        setApiKeyInput('');
      }
    } catch (err) {
      console.error('Failed to clear API key:', err);
    }
  };
  
  // Handler for toggling continuous context enabled state
  const handleToggleContinuousContext = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setContinuousContextEnabled) return;

    try {
      const success = await window.clipboardAPI.setContinuousContextEnabled(enabled);
      if (success) {
        setContinuousContextEnabled(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle continuous context:', err);
    }
  };

  // Handler for toggling permission reminders (screen recording banner)
  const handleTogglePermissionReminders = async (show: boolean) => {
    if (!window.clipboardAPI?.setHideScreenRecordingBanner) return;

    try {
      // Invert the value because we store "hide" but display as "show reminders"
      const success = await window.clipboardAPI.setHideScreenRecordingBanner(!show);
      if (success) {
        setShowPermissionReminders(show);
      }
    } catch (err) {
      console.error('Failed to toggle permission reminders:', err);
    }
  };
  
  // Handler for toggling cursor status indicator
  const handleToggleCursorStatus = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setCursorStatusEnabled) return;

    try {
      const success = await window.clipboardAPI.setCursorStatusEnabled(enabled);
      if (success) {
        setCursorStatusEnabled(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle cursor status indicator:', err);
    }
  };
  
  // Handler for toggling hide status labels (show only dots, no text).
  const handleToggleHideStatusLabels = async (hide: boolean) => {
    if (!window.clipboardAPI?.setHideStatusLabels) return;

    try {
      const success = await window.clipboardAPI.setHideStatusLabels(hide);
      if (success) {
        setHideStatusLabels(hide);
      }
    } catch (err) {
      console.error('Failed to toggle hide status labels:', err);
    }
  };
  
  // Check Supabase auth state on mount and listen for changes.
  // When authenticated, pass session to main process for mobile sync.
  // The sign-in form is in TeamView - this just listens for session changes.
  useEffect(() => {
    // If supabase client is not available, skip auth. This can happen if
    // environment variables are missing during development.
    if (!supabase) {
      console.warn('[SettingsPanel] Supabase client not available');
      return;
    }

    // Get initial session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // Pass session to main process for MobileSync.
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      }
    });

    // Listen for auth changes (triggered by TeamView sign-in or token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      } else {
        window.clipboardAPI?.clearSyncSession?.();
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // Handle sign out.
  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await window.authAPI?.signOut();
      if (supabase) {
        await supabase.auth.signOut();
      }
      
      // Supabase persists session in localStorage. When signOut() fails with
      // "Auth session missing!", it doesn't clear storage. We must clear it
      // manually to prevent getSession() from restoring the old session.
      const supabaseKeys = Object.keys(localStorage).filter(k => k.startsWith('sb-'));
      supabaseKeys.forEach(k => localStorage.removeItem(k));
      
      setSyncStatus(null);
      setSession(null);
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle manual sync trigger - syncs both transcripts and todos.
  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    
    try {
      // Sync transcripts.
      let transcriptCount = 0;
      if (window.clipboardAPI?.syncMobileTranscripts) {
        transcriptCount = await window.clipboardAPI.syncMobileTranscripts();
      }
      
      // Sync todos.
      let todoCount = 0;
      if (window.todoAPI?.syncTodos) {
        const todos = await window.todoAPI.syncTodos();
        todoCount = todos.length;
      }
      
      // Build status message.
      const parts: string[] = [];
      if (transcriptCount > 0) {
        parts.push(`${transcriptCount} transcript${transcriptCount === 1 ? '' : 's'}`);
      }
      if (todoCount > 0) {
        parts.push(`${todoCount} task${todoCount === 1 ? '' : 's'}`);
      }
      
      setSyncStatus(parts.length > 0 
        ? `Synced ${parts.join(' and ')} from iOS`
        : 'Already up to date'
      );
    } catch (err) {
      setSyncStatus('Sync failed');
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Force full re-sync - fixes source attribution for existing items
  const handleForceSync = async () => {
    if (!window.clipboardAPI?.forceSyncAll) return;
    
    setIsSyncing(true);
    setSyncStatus('Re-syncing all transcripts...');
    
    try {
      const count = await window.clipboardAPI.forceSyncAll();
      setSyncStatus(count > 0 
        ? `Fixed attribution for ${count} transcript${count === 1 ? '' : 's'}`
        : 'All transcripts already correctly attributed'
      );
    } catch (err) {
      setSyncStatus('Re-sync failed');
      console.error('Force sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Helper function to build hotkey string from keyboard event (uses physical key codes)
  const buildHotkeyString = (event: KeyboardEvent): string => {
    const parts: string[] = [];
    if (event.metaKey) parts.push('Command');
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Use physical key code to avoid locale-specific characters
    let key = event.code;

    if (key.startsWith('Key')) {
      key = key.substring(3).toUpperCase();
    } else if (key.startsWith('Digit')) {
      key = key.substring(5);
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
        const fallback = event.key;
        if (fallback && fallback.length === 1 && fallback.charCodeAt(0) < 128) {
          key = fallback.toUpperCase();
        } else {
          console.warn(`[Hotkey] Unsupported key: ${event.code} (key: ${event.key})`);
          return '';
        }
      }
    }

    // Filter out modifier-only key presses (both the base name and Left/Right variants).
    const modifierCodes = [
      'Meta', 'MetaLeft', 'MetaRight',
      'Control', 'ControlLeft', 'ControlRight',
      'Alt', 'AltLeft', 'AltRight',
      'Shift', 'ShiftLeft', 'ShiftRight'
    ];
    if (modifierCodes.includes(event.code)) {
      return '';
    }

    return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
  };

  const isModifierOnly = (s: string) => {
    return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
  };
  
  // Handler for setting screenshot hotkey
  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingScreenshotHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
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
  
  // Handler for setting desktop screenshot hotkey
  const handleSetDesktopScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingDesktopScreenshotHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ desktopScreenshot: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register desktop screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, desktopScreenshot: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set desktop screenshot hotkey');
      console.error('Failed to set desktop screenshot hotkey:', err);
    }
  }, []);
  
  // Handler for setting history hotkey
  const handleSetHistoryHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingHistoryHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
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
  
  // Handler for setting continuous context hotkey
  const handleSetContinuousContextHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingContinuousContextHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI?.setContinuousContextHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setContinuousContextHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register continuous context hotkey. It may be in use by another application.');
      } else {
        setContinuousContextHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set continuous context hotkey');
      console.error('Failed to set continuous context hotkey:', err);
    }
  }, []);

  // Handler for setting todo hotkey
  const handleSetTodoHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingTodoHotkey(false);
    setHotkeyError(null);
    
    if (!window.todoAPI?.setHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.todoAPI.setHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register todo hotkey. It may be in use by another application.');
      } else {
        setTodoHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set todo hotkey');
      console.error('Failed to set todo hotkey:', err);
    }
  }, []);
  
  // Handler for setting transcription hotkey
  const handleSetTranscriptionHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingTranscriptionHotkey(false);
    setHotkeyError(null);
    
    if (!window.transcribeAPI?.setHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.transcribeAPI.setHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register transcription hotkey. It may be in use by another application.');
      } else {
        setTranscriptionHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set transcription hotkey');
      console.error('Failed to set transcription hotkey:', err);
    }
  }, []);
  
  // Handler for setting abandon recording hotkey
  const handleSetAbandonHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingAbandonHotkey(false);
    setHotkeyError(null);
    
    if (!window.transcribeAPI?.setAbandonHotkey) return;
    
    // Abandon hotkey can be a single key like Escape
    try {
      const success = await window.transcribeAPI.setAbandonHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register abandon hotkey. It may be in use by another application.');
      } else {
        setAbandonHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set abandon hotkey');
      console.error('Failed to set abandon hotkey:', err);
    }
  }, []);
  
  // Handler for toggling abandon confirmation
  const handleAbandonConfirmationChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setAbandonConfirmation) return;
    try {
      await window.transcribeAPI.setAbandonConfirmation(enabled);
      setAbandonConfirmation(enabled);
    } catch (err) {
      console.error('Failed to set abandon confirmation:', err);
    }
  }, []);
  
  // Capture hotkey when user is setting any shortcut.
  useEffect(() => {
    const capturing = isCapturingScreenshotHotkey ? 'screenshot' 
      : isCapturingHistoryHotkey ? 'history' 
      : isCapturingDesktopScreenshotHotkey ? 'desktopScreenshot'
      : isCapturingContinuousContextHotkey ? 'continuousContext'
      : isCapturingTodoHotkey ? 'todo'
      : isCapturingTranscriptionHotkey ? 'transcription'
      : isCapturingAbandonHotkey ? 'abandon'
      : null;
    if (!capturing) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        if (capturing === 'screenshot') {
          handleSetScreenshotHotkey(hotkeyString);
        } else if (capturing === 'history') {
          handleSetHistoryHotkey(hotkeyString);
        } else if (capturing === 'desktopScreenshot') {
          handleSetDesktopScreenshotHotkey(hotkeyString);
        } else if (capturing === 'todo') {
          handleSetTodoHotkey(hotkeyString);
        } else if (capturing === 'transcription') {
          handleSetTranscriptionHotkey(hotkeyString);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCapturingScreenshotHotkey, isCapturingHistoryHotkey, isCapturingDesktopScreenshotHotkey, isCapturingContinuousContextHotkey, isCapturingTodoHotkey, isCapturingTranscriptionHotkey, isCapturingAbandonHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey, handleSetDesktopScreenshotHotkey, handleSetContinuousContextHotkey, handleSetTodoHotkey, handleSetTranscriptionHotkey, handleSetAbandonHotkey]);

  // Check permissions on mount and when status changes
  useEffect(() => {
    const permissionsAPI = window.permissionsAPI;
    if (!permissionsAPI) {
      console.log('[SettingsPanel] permissionsAPI not available, assuming permissions granted');
      setPermissions({ accessibilityGranted: true });
      setShowPermissionsGate(false);
      return;
    }

    const checkPermissions = async () => {
      try {
        const status = await permissionsAPI.check();
        setPermissions(status);
        setShowPermissionsGate(!status.accessibilityGranted);
      } catch (error) {
        console.error('Failed to check permissions:', error);
        setPermissions({ accessibilityGranted: true });
        setShowPermissionsGate(false);
      }
    };

    checkPermissions();

    const unsubscribeStatus = permissionsAPI.onStatusChanged((status: { accessibilityGranted: boolean }) => {
      setPermissions(status);
      setShowPermissionsGate(!status.accessibilityGranted);
    });

    const unsubscribeRevoked = permissionsAPI.onRevoked(() => {
      setShowPermissionsGate(true);
      checkPermissions();
    });

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    if (showPermissionsGate) {
      pollInterval = setInterval(() => {
        checkPermissions();
      }, 2000);
    }

    return () => {
      unsubscribeStatus?.();
      unsubscribeRevoked?.();
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [showPermissionsGate]);

  // Show loading state while checking permissions
  if (permissions === null) {
    return (
      <div style={styles.loading}>
        <div style={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  // Permissions gate - show inline warning instead of blocking the whole UI
  const permissionsWarning = showPermissionsGate && permissions && !permissions.accessibilityGranted && (
    <div style={styles.permissionsWarning}>
      <div style={styles.permissionsContent}>
        <h3 style={styles.permissionsTitle}>⚠️ Accessibility Permission Required</h3>
        <p style={styles.permissionsText}>
          Field Theory needs Accessibility permission to paste clipboard items.
        </p>
        <button
          onClick={() => {
            window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', '_blank');
          }}
          style={styles.permissionsButton}
        >
          Open Settings
        </button>
      </div>
    </div>
  );

  // Section header component for consistent divider styling
  const SectionHeader = ({ title }: { title: string }) => (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionTitle}>{title}</span>
      <div style={styles.sectionLine} />
    </div>
  );

  return (
    <div style={styles.container}>
      {permissionsWarning}

      {/* Keyboard Shortcuts Section - First for easy access */}
      <div style={styles.section}>
        <SectionHeader title="Keyboard Shortcuts" />
        
        {/* Open Field Theory - primary action, shown first */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Open Field Theory</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingHistoryHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingDesktopScreenshotHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingHistoryHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingHistoryHotkey ? 'Press keys...' : clipboardHotkeys.history || '⌥Space'}
            </button>
            {isCapturingHistoryHotkey && (
              <button onClick={() => { setIsCapturingHistoryHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Transcription (Record) */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Transcription</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingTranscriptionHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingDesktopScreenshotHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingTranscriptionHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingTranscriptionHotkey ? 'Press keys...' : transcriptionHotkey}
            </button>
            {isCapturingTranscriptionHotkey && (
              <button onClick={() => { setIsCapturingTranscriptionHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingScreenshotHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingDesktopScreenshotHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingScreenshotHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingScreenshotHotkey ? 'Press keys...' : clipboardHotkeys.screenshot || '⌘4'}
            </button>
            {isCapturingScreenshotHotkey && (
              <button onClick={() => { setIsCapturingScreenshotHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Desktop Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Desktop Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingDesktopScreenshotHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingDesktopScreenshotHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingDesktopScreenshotHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingDesktopScreenshotHotkey ? 'Press keys...' : clipboardHotkeys.desktopScreenshot || '⌘3'}
            </button>
            {isCapturingDesktopScreenshotHotkey && (
              <button onClick={() => { setIsCapturingDesktopScreenshotHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Sounds Enabled - master toggle for all sounds */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Sounds</span>
          <div style={styles.rowControls}>
            <button
              onClick={async () => {
                const newValue = !soundsEnabled;
                const success = await window.clipboardAPI?.setSoundsEnabled?.(newValue);
                if (success) setSoundsEnabled(newValue);
              }}
              style={{ ...styles.toggle, backgroundColor: soundsEnabled ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: soundsEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>
        
        {/* Permission Reminders - show/hide the screen recording permission banner */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Permission Reminders</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => handleTogglePermissionReminders(!showPermissionReminders)}
              style={{ ...styles.toggle, backgroundColor: showPermissionReminders ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: showPermissionReminders ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>
        
        {/* Cursor Status Indicator - shows dot next to cursor during recording/transcribing */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Cursor Status Indicator</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => handleToggleCursorStatus(!cursorStatusEnabled)}
              style={{ ...styles.toggle, backgroundColor: cursorStatusEnabled ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: cursorStatusEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>
        
        {/* Hide Status Labels - show only colored dots (requires cursor status enabled) */}
        {cursorStatusEnabled && (
          <div style={styles.row}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={styles.rowLabel}>Show Status Labels</span>
              <span style={{ ...styles.rowHint, marginTop: 0 }}>When off, show only colored dots</span>
            </div>
            <div style={styles.rowControls}>
              <button
                onClick={async () => {
                  const newValue = !hideStatusLabels;
                  const success = await window.clipboardAPI?.setHideStatusLabels?.(newValue);
                  if (success) setHideStatusLabels(newValue);
                }}
                style={{ ...styles.toggle, backgroundColor: !hideStatusLabels ? theme.accent : '#d1d5db' }}
              >
                <span style={{ ...styles.toggleKnob, transform: !hideStatusLabels ? 'translateX(20px)' : 'translateX(2px)' }} />
              </button>
            </div>
          </div>
        )}
        
        {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}
      </div>

      {/* Audio Section */}
      <div style={styles.section}>
        <SectionHeader title="Audio" />
        <AudioSettingsPanel />
      </div>

      {/* Transcription Section */}
      <div style={styles.section}>
        <SectionHeader title="Transcription" />
        <TranscriptionSettings />
      </div>

      {/* AI Features Section */}
      <div style={styles.section}>
        <SectionHeader title="AI Features" />
        
        {/* API Key Row */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Anthropic API Key</span>
          <div style={styles.rowControls}>
            {hasApiKey ? (
              <>
                <span style={{ ...styles.rowValue, color: theme.accent }}>✓ Configured</span>
                <button onClick={handleClearApiKey} style={{ ...styles.btn, ...styles.btnDanger }}>
                  Clear
                </button>
              </>
            ) : (
              <>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  style={{ ...styles.input, fontFamily: 'monospace', width: '180px' }}
                />
                <button onClick={() => setShowApiKey(!showApiKey)} style={styles.btnGhost}>
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={handleSaveApiKey}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                  style={{
                    ...styles.btn,
                    ...(apiKeySaving || !apiKeyInput.trim() ? {} : styles.btnSuccess),
                    opacity: apiKeySaving || !apiKeyInput.trim() ? 0.5 : 1,
                    cursor: apiKeySaving || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {apiKeySaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        {apiKeyError && <p style={styles.error}>{apiKeyError}</p>}
        
        {/* Prompt Settings */}
        <PromptSettings />
      </div>

      {/* Mobile Sync Section */}
      <div style={styles.section}>
        <SectionHeader title="Mobile Sync" />
        
        {session ? (
          <>
            <div style={styles.row}>
              <div style={styles.syncUserInfo}>
                <span style={styles.syncUserIcon}>✓</span>
                <span style={styles.rowValue}>{session.user.email === 'andrew.mfarah@gmail.com' ? 'A. Farah' : session.user.email}</span>
              </div>
              <div style={styles.rowControls}>
                <button onClick={handleManualSync} disabled={isSyncing} style={styles.btn}>
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </button>
                <button onClick={handleForceSync} disabled={isSyncing} style={styles.btn} title="Fix source attribution">
                  Fix
                </button>
                <button onClick={handleSignOut} disabled={authLoading} style={styles.btnGhost}>
                  {authLoading ? '...' : 'Sign Out'}
                </button>
              </div>
            </div>
            {syncStatus && <p style={styles.syncStatusText}>{syncStatus}</p>}
          </>
        ) : (
          // Not signed in - direct user to Team tab.
          <div style={styles.row}>
            <span style={{ ...styles.rowValue, color: theme.textSecondary }}>
              Sign in via the Team tab to enable mobile sync.
            </span>
          </div>
        )}
      </div>
      
      {/* Experimental Section */}
      <div style={styles.section}>
        <SectionHeader title="Experimental" />
        
        {/* Tasks Tab toggle */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={styles.rowLabel}>Tasks Tab</span>
            <span style={{ ...styles.rowHint, marginTop: 0 }}>Show Tasks tab (syncs todos from iOS)</span>
          </div>
          <div style={styles.rowControls}>
            <button
              onClick={async () => {
                const newValue = !tasksTabEnabled;
                const success = await window.clipboardAPI?.setTasksTabEnabled?.(newValue);
                if (success) setTasksTabEnabled(newValue);
              }}
              style={{ ...styles.toggle, backgroundColor: tasksTabEnabled ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: tasksTabEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>
        
        {/* Tasks hotkey (only show if tasks enabled) */}
        {tasksTabEnabled && (
          <div style={styles.row}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={styles.rowLabel}>Tasks Hotkey</span>
              <span style={{ ...styles.rowHint, marginTop: 0 }}>Open Tasks from anywhere</span>
            </div>
            <div style={styles.rowControls}>
              <button
                onClick={() => { setIsCapturingTodoHotkey(true); setHotkeyError(null); }}
                disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingDesktopScreenshotHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey}
                style={{ ...styles.btn, ...(isCapturingTodoHotkey ? styles.btnActive : {}) }}
              >
                {isCapturingTodoHotkey ? 'Press keys...' : todoHotkey || '⌘⇧T'}
              </button>
              {isCapturingTodoHotkey && (
                <button onClick={() => { setIsCapturingTodoHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Subscription Section */}
      {(() => {
        // Only trust cached 'pro' tier if user is actually signed in.
        // When no session exists, always display 'free' tier.
        const displayTier = session ? userTier : 'free';
        
        // Display names: 'free' -> 'Free Plan', 'pro' -> 'Pro Plan'
        const tierDisplayName = displayTier === 'pro' ? 'Pro Plan' : 'Free Plan';
        
        return (
          <div style={styles.section}>
            <SectionHeader title="Subscription" />
            
            <div style={styles.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={styles.rowLabel}>Current Plan</span>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 600,
                    backgroundColor: displayTier === 'pro' ? theme.accent : theme.bgSecondary,
                    color: displayTier === 'pro' ? '#fff' : theme.textSecondary,
                  }}>
                    {tierDisplayName}
                  </span>
                </div>
                <p style={styles.rowHint}>
                  {displayTier === 'free'
                    ? 'Upgrade for unlimited priority mic and auto-stacking.'
                    : 'Unlimited priority mic and auto-stacking, plus all-time stats.'}
                </p>
              </div>
              <div style={styles.rowControls}>
                {displayTier === 'free' ? (
                  <button 
                    onClick={() => {
                      // Require sign-in before upgrading.
                      if (!session) {
                        // Could show a modal here, but for now just alert.
                        alert('Please sign in first to upgrade. Go to the Team tab to sign in.');
                        return;
                      }
                      // Open Stripe checkout with user ID for webhook linking.
                      // Opens in browser to avoid Apple's 30% in-app purchase tax.
                      const userId = session.user.id;
                      const paymentLink = window.stripeConfig?.paymentLink || '';
                      window.shellAPI?.openExternal(
                        `${paymentLink}?client_reference_id=${userId}`
                      );
                    }}
                    style={{
                      ...styles.btn,
                      backgroundColor: theme.accent,
                      color: '#fff',
                      border: 'none',
                    }}
                  >
                    Upgrade
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      // Open Stripe Customer Portal for subscription management.
                      const portalLink = window.stripeConfig?.portalLink || '';
                      window.shellAPI?.openExternal(portalLink);
                    }}
                    style={styles.btn}
                  >
                    Manage Subscription
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Styles consistent with ClipboardHistory styling
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  loadingText: {
    color: '#6b7280',
    fontSize: '13px',
  },
  
  // ==========================================================================
  // NEW UNIFIED DESIGN SYSTEM - Only 2 font sizes: 13px body, 11px headers
  // ==========================================================================
  
  title: {
    fontSize: '13px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '24px',
    color: '#111827',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  
  // Section with divider line
  section: {
    marginBottom: '20px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#e5e7eb',
  },
  
  // Flat row layout: label left, control right
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    minHeight: '32px',
  },
  rowLabel: {
    fontSize: '13px',
    color: '#374151',
    fontWeight: 400,
  },
  rowValue: {
    fontSize: '13px',
    color: '#111827',
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rowHint: {
    fontSize: '13px',
    color: '#6b7280',
    fontWeight: 400,
  },
  
  // Unified button styles
  btn: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: '#14372A',
    color: '#fff',
    borderColor: '#14372A',
  },
  btnDanger: {
    color: '#dc2626',
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  btnSuccess: {
    color: '#fff',
    backgroundColor: '#14372A',
    borderColor: '#14372A',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    minWidth: 'auto',
    padding: '6px 8px',
  },
  
  // Toggle switch
  toggle: {
    position: 'relative' as const,
    width: '44px',
    minWidth: '44px',
    height: '24px',
    minHeight: '24px',
    borderRadius: '12px',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    flexShrink: 0,
    transition: 'background-color 0.2s',
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: '2px',
    left: 0,
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
  
  // Select dropdown
  select: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '160px',
  },
  
  // Input field
  input: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#111827',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    flex: 1,
  },
  
  // Status indicators
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '6px',
  },
  statusGreen: { backgroundColor: '#14372A' },
  statusYellow: { backgroundColor: '#f59e0b' },
  statusRed: { backgroundColor: '#ef4444' },
  statusGray: { backgroundColor: '#9ca3af' },
  
  // Error text
  error: {
    fontSize: '13px',
    color: '#ef4444',
    marginTop: '4px',
  },
  
  // Model list (compact)
  modelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  modelName: {
    fontSize: '13px',
    color: '#374151',
  },
  modelSize: {
    fontSize: '13px',
    color: '#9ca3af',
    marginLeft: '8px',
  },
  
  // Permissions warning (compact)
  permissionsWarning: {
    backgroundColor: '#fffbeb',
    border: '1px solid #f59e0b',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  permissionsContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permissionsText: {
    fontSize: '13px',
    color: '#92400e',
    margin: 0,
  },
  permissionsButton: {
    padding: '6px 12px',
    backgroundColor: '#f59e0b',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  
  // Mobile sync (logged in state)
  syncUserInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  syncUserIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    backgroundColor: '#14372A',
    color: '#fff',
    borderRadius: '50%',
    fontSize: '10px',
    fontWeight: 600,
  },
  
  // Login form (compact)
  loginForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  
  // Legacy compatibility - keeping for nested components
  hotkeyCard: {
    padding: 0,
  },
  hotkeyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    minHeight: '36px',
  },
  hotkeyLabel: {
    fontSize: '13px',
    color: '#374151',
  },
  hotkeyButtonRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  hotkeyButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  hotkeyButtonActive: {
    backgroundColor: '#14372A',
    color: '#fff',
    borderColor: '#14372A',
  },
  cancelButton: {
    padding: '6px 8px',
    fontSize: '13px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  hotkeyError: {
    fontSize: '13px',
    color: '#ef4444',
    marginTop: '4px',
  },
  loginInput: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  loginButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#14372A',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  signOutButton: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  syncButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  fixButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncStatusText: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: '4px',
  },
  sectionDescription: {
    display: 'none', // Hide verbose descriptions in new design
  },
  hotkeyTitle: {
    display: 'none', // Hide nested titles in new design
  },
  hotkeyHelp: {
    display: 'none', // Hide help text in new design
  },
};
