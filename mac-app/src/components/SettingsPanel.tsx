// =============================================================================
// SettingsPanel - Consolidated settings UI for the clipboard history window.
// Shows audio, transcription, and clipboard settings in one view.
// Styled consistently with the clipboard history window's design language.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import AudioSettingsPanel from './AudioSettingsPanel';
import TranscriptionSettings from './TranscriptionSettings';
import PromptSettings from './PromptSettings';
import DiagnosticsModal from './DiagnosticsModal';
import CommandsSettings from './CommandsSettings';
import { supabase } from '../supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { accentPresets, AccentPreset } from '../design/tokens';

interface SettingsPanelProps {
  onNavigateToSignIn?: () => void;
  onNavigateToFeedback?: () => void;
}

/**
 * SettingsPanel - Settings content designed to live inside the clipboard history window.
 * Keeps the same functionality as the original App.tsx settings, but styled for the
 * clipboard history context.
 */
export default function SettingsPanel({ onNavigateToSignIn, onNavigateToFeedback }: SettingsPanelProps) {
  const { theme, toggleDarkMode, accentPreset, setAccentPreset, darkModeIntensity, setDarkModeIntensity } = useTheme();
  // Permissions state
  const [permissions, setPermissions] = useState<{ accessibilityGranted: boolean } | null>(null);
  const [showPermissionsGate, setShowPermissionsGate] = useState(false);
  
  // System Access permissions state (microphone, accessibility, screen recording)
  const [systemPermissions, setSystemPermissions] = useState<{
    microphone: 'granted' | 'denied' | 'not-determined';
    accessibility: boolean;
    screenRecording: boolean;
  } | null>(null);
  
  // Clipboard hotkey configuration
  const [clipboardHotkeys, setClipboardHotkeys] = useState<{ screenshot?: string; history?: string; fullScreen?: string; activeWindow?: string }>({
    screenshot: 'CommandOrControl+Shift+4',
    history: 'CommandOrControl+Shift+V',
    fullScreen: 'Command+3',
    activeWindow: 'Command+Shift+3',
  });
  const [isCapturingScreenshotHotkey, setIsCapturingScreenshotHotkey] = useState(false);
  const [isCapturingHistoryHotkey, setIsCapturingHistoryHotkey] = useState(false);
  const [isCapturingFullScreenHotkey, setIsCapturingFullScreenHotkey] = useState(false);
  const [isCapturingActiveWindowHotkey, setIsCapturingActiveWindowHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  
  // Continuous Context configuration
  const [continuousContextEnabled, setContinuousContextEnabled] = useState(false);
  const [continuousContextHotkey, setContinuousContextHotkey] = useState('Shift+Command+4');
  const [isCapturingContinuousContextHotkey, setIsCapturingContinuousContextHotkey] = useState(false);
  
  // Todo hotkey configuration
  const [todoHotkey, setTodoHotkey] = useState('Command+Shift+T');
  const [isCapturingTodoHotkey, setIsCapturingTodoHotkey] = useState(false);

  // Additional hotkeys (SuperPaste, CommandLauncher, ImproveText, AutoImprove)
  const [superPasteHotkey, setSuperPasteHotkey] = useState('Command+Shift+V');
  const [isCapturingSuperPasteHotkey, setIsCapturingSuperPasteHotkey] = useState(false);
  const [commandLauncherHotkey, setCommandLauncherHotkey] = useState('Command+Shift+K');
  const [isCapturingCommandLauncherHotkey, setIsCapturingCommandLauncherHotkey] = useState(false);

  // Transcription hotkey configuration
  const [transcriptionHotkey, setTranscriptionHotkey] = useState('Command+\\');
  const [isCapturingTranscriptionHotkey, setIsCapturingTranscriptionHotkey] = useState(false);
  const [secondaryTranscriptionHotkey, setSecondaryTranscriptionHotkey] = useState<string | null>(null);
  const [isCapturingSecondaryTranscriptionHotkey, setIsCapturingSecondaryTranscriptionHotkey] = useState(false);

  // Abandon recording hotkey configuration
  const [abandonHotkey, setAbandonHotkey] = useState('Escape');
  const [isCapturingAbandonHotkey, setIsCapturingAbandonHotkey] = useState(false);
  const [abandonConfirmation, setAbandonConfirmation] = useState(true);
  
  // Mobile sync state - sign-in is handled via TeamView, we just listen for session.
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Delete account state.
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  
  // API key state - for Engineer feature (Anthropic API)
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [detectedProvider, setDetectedProvider] = useState<string>('unknown');
  const [apiKeyTesting, setApiKeyTesting] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Auto-improve transcripts state
  const [autoImprove, setAutoImprove] = useState(false);
  const [autoImproveMinWords, setAutoImproveMinWords] = useState(60);

  // Local LLM state
  const [useLocalLLM, setUseLocalLLM] = useState(false);
  const [localLLMModels, setLocalLLMModels] = useState<Record<string, { name: string; filename: string; sizeBytes: number; description: string }>>({});
  const [localLLMStatus, setLocalLLMStatus] = useState<Record<string, boolean>>({});
  const [selectedLocalLLM, setSelectedLocalLLM] = useState<string>('llama-3.2-1b');
  const [downloadingLocalLLM, setDownloadingLocalLLM] = useState<string | null>(null);
  const [localLLMProgress, setLocalLLMProgress] = useState<{ downloaded: number; total: number } | null>(null);

  // Permission banner state - whether to show reminders for missing permissions.
  const [showPermissionReminders, setShowPermissionReminders] = useState(true);
  
  // Hide status labels - show only colored dots.
  const [hideStatusLabels, setHideStatusLabels] = useState(false);
  
  // Sounds enabled - master toggle for all sounds.
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  
  // Tasks tab - experimental feature.
  const [tasksTabEnabled, setTasksTabEnabled] = useState(false);
  
  // Show in Dock - whether app appears in Dock and Cmd+Tab.
  const [showInDock, setShowInDock] = useState(false);

  // Launch at login - start app when macOS starts.
  const [launchAtLogin, setLaunchAtLogin] = useState(true);

  // Subscription tier state - 'free' or 'pro'.
  const [userTier, setUserTier] = useState<'free' | 'pro'>('free');
  
  // Quota usage for free users (formatted strings like "10/500 min").
  const [quotaUsage, setQuotaUsage] = useState<{ priorityMic: string; autoStack: string } | null>(null);
  
  // Diagnostics modal visibility.
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const styles = getStyles(theme);

  // Load system permissions on mount and when window gains focus
  useEffect(() => {
    const loadSystemPermissions = async () => {
      if (window.onboardingAPI?.getPermissionStatus) {
        try {
          const status = await window.onboardingAPI.getPermissionStatus();
          setSystemPermissions(status);
        } catch (err) {
          console.error('[SettingsPanel] Failed to load system permissions:', err);
        }
      }
    };
    
    loadSystemPermissions();
    
    // Refresh when window gains focus (user may have just changed settings)
    const handleFocus = () => loadSystemPermissions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

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
      
      // Load API key info (status, masked key, provider)
      window.clipboardAPI.getApiKeyInfo?.().then(info => {
        setHasApiKey(info.hasKey);
        setMaskedApiKey(info.maskedKey);
        setDetectedProvider(info.provider);
      });

      // Load auto-improve settings
      window.transcribeAPI?.getAutoImprove?.().then(enabled => {
        setAutoImprove(enabled);
      });
      window.transcribeAPI?.getAutoImproveMinWords?.().then(minWords => {
        setAutoImproveMinWords(minWords);
      });

      // Load local LLM settings
      window.clipboardAPI?.getLocalLLMModels?.().then(models => {
        setLocalLLMModels(models);
      });
      window.clipboardAPI?.getLocalLLMStatus?.().then(status => {
        setLocalLLMStatus(status);
      });
      window.clipboardAPI?.getLocalLLMSelected?.().then(model => {
        setSelectedLocalLLM(model);
      });
      window.clipboardAPI?.getUseLocalLLM?.().then(useLocal => {
        setUseLocalLLM(useLocal);
      });

      // Subscribe to download progress
      const unsubProgress = window.clipboardAPI?.onLocalLLMDownloadProgress?.((data) => {
        setLocalLLMProgress({ downloaded: data.downloaded, total: data.total });
      });

      // Load permission banner setting
      window.clipboardAPI.getHideScreenRecordingBanner?.().then(hide => {
        setShowPermissionReminders(!hide);
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
      
      // Load show in dock setting
      window.clipboardAPI.getShowInDock?.().then(show => {
        setShowInDock(show);
      });

      // Load launch at login setting
      window.clipboardAPI.getLaunchAtLogin?.().then(enabled => {
        setLaunchAtLogin(enabled);
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

    // Load additional hotkeys (SuperPaste, CommandLauncher)
    if (window.hotkeyAPI) {
      window.hotkeyAPI.getHotkey('superPaste').then(hotkey => {
        if (hotkey) setSuperPasteHotkey(hotkey);
      });
      window.hotkeyAPI.getHotkey('commandLauncher').then(hotkey => {
        if (hotkey) setCommandLauncherHotkey(hotkey);
      });
    }

    // Load transcription hotkeys
    if (window.transcribeAPI) {
      window.transcribeAPI.getHotkey().then(hotkey => {
        if (hotkey) {
          setTranscriptionHotkey(hotkey);
        }
      });
      window.transcribeAPI.getSecondaryHotkey?.().then(hotkey => {
        setSecondaryTranscriptionHotkey(hotkey);
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
    
    // Load user tier and quota usage from quota manager.
    if (window.quotaAPI?.getQuotas) {
      window.quotaAPI.getQuotas().then(quotas => {
        if (quotas) {
          setUserTier(quotas.tier);
        }
      });
    }
    if (window.quotaAPI?.getFormattedUsage) {
      window.quotaAPI.getFormattedUsage().then(formatted => {
        if (formatted) setQuotaUsage(formatted);
      });
    }
    
    // Listen for tier changes (e.g., after Stripe checkout).
    let unsubscribeTier: (() => void) | undefined;
    if (window.quotaAPI?.onTierChanged) {
      unsubscribeTier = window.quotaAPI.onTierChanged((tier) => {
        setUserTier(tier);
      });
    }
    
    // Listen for quota changes to update usage in real-time.
    let unsubscribeQuota: (() => void) | undefined;
    if (window.quotaAPI?.onQuotaChanged) {
      unsubscribeQuota = window.quotaAPI.onQuotaChanged((formatted) => {
        setQuotaUsage(formatted);
      });
    }
    
    return () => {
      unsubscribeTier?.();
      unsubscribeQuota?.();
    };
  }, []);
  
  // Handler for saving API key
  const handleSaveApiKey = async () => {
    if (!window.clipboardAPI?.setApiKey || !apiKeyInput.trim()) return;

    setApiKeySaving(true);
    setApiKeyError(null);
    setApiKeyTestResult(null);

    try {
      const result = await window.clipboardAPI.setApiKey(apiKeyInput.trim());
      if (result.success) {
        setHasApiKey(true);
        setApiKeyInput('');
        // Refresh API key info to get masked key and provider
        const info = await window.clipboardAPI.getApiKeyInfo?.();
        if (info) {
          setMaskedApiKey(info.maskedKey);
          setDetectedProvider(info.provider);
        }
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
        setMaskedApiKey(null);
        setDetectedProvider('unknown');
        setApiKeyTestResult(null);
      }
    } catch (err) {
      console.error('Failed to clear API key:', err);
    }
  };

  // Handler for testing API key connection
  const handleTestApiKey = async () => {
    if (!window.clipboardAPI?.testApiKey) return;

    setApiKeyTesting(true);
    setApiKeyTestResult(null);

    try {
      const result = await window.clipboardAPI.testApiKey();
      setApiKeyTestResult(result);
    } catch (err) {
      setApiKeyTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed'
      });
    } finally {
      setApiKeyTesting(false);
    }
  };

  // Handler for toggling auto-improve
  const handleAutoImproveChange = async (enabled: boolean) => {
    if (!window.transcribeAPI?.setAutoImprove) return;

    setAutoImprove(enabled);
    try {
      await window.transcribeAPI.setAutoImprove(enabled);
    } catch (err) {
      console.error('Failed to change auto-improve setting:', err);
    }
  };

  // Handler for changing auto-improve minimum words
  const handleAutoImproveMinWordsChange = async (minWords: number) => {
    if (!window.transcribeAPI?.setAutoImproveMinWords) return;

    setAutoImproveMinWords(minWords);
    try {
      await window.transcribeAPI.setAutoImproveMinWords(minWords);
    } catch (err) {
      console.error('Failed to change auto-improve min words:', err);
    }
  };

  // Handler for toggling use local LLM
  const handleUseLocalLLMChange = async (useLocal: boolean) => {
    if (!window.clipboardAPI?.setUseLocalLLM) return;

    setUseLocalLLM(useLocal);
    try {
      await window.clipboardAPI.setUseLocalLLM(useLocal);
    } catch (err) {
      console.error('Failed to change use local LLM setting:', err);
    }
  };

  // Handler for downloading local LLM model
  const handleDownloadLocalLLM = async (model: string) => {
    if (!window.clipboardAPI?.downloadLocalLLM || downloadingLocalLLM) return;

    setDownloadingLocalLLM(model);
    setLocalLLMProgress(null);
    try {
      const result = await window.clipboardAPI.downloadLocalLLM(model);
      if (result.success) {
        // Refresh status
        const status = await window.clipboardAPI.getLocalLLMStatus?.();
        if (status) setLocalLLMStatus(status);
      }
    } catch (err) {
      console.error('Failed to download local LLM:', err);
    } finally {
      setDownloadingLocalLLM(null);
      setLocalLLMProgress(null);
    }
  };

  // Handler for deleting local LLM model
  const handleDeleteLocalLLM = async (model: string) => {
    if (!window.clipboardAPI?.deleteLocalLLM) return;

    try {
      await window.clipboardAPI.deleteLocalLLM(model);
      // Refresh status
      const status = await window.clipboardAPI.getLocalLLMStatus?.();
      if (status) setLocalLLMStatus(status);
    } catch (err) {
      console.error('Failed to delete local LLM:', err);
    }
  };

  // Handler for selecting local LLM model
  const handleSelectLocalLLM = async (model: string) => {
    if (!window.clipboardAPI?.setLocalLLMSelected) return;

    setSelectedLocalLLM(model);
    try {
      await window.clipboardAPI.setLocalLLMSelected(model);
    } catch (err) {
      console.error('Failed to select local LLM:', err);
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[SettingsPanel] Auth event: ${event}, session: ${session ? 'present' : 'null'}`);
      setSession(session);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      } else if (event === 'SIGNED_OUT') {
        // Only clear on explicit sign-out, not on token refresh failures.
        console.log(`[SettingsPanel] User signed out - clearing sync session`);
        window.clipboardAPI?.clearSyncSession?.();
      } else {
        console.log(`[SettingsPanel] Session became null after ${event} event - not clearing main process session`);
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
  
  // Handle account deletion.
  const handleDeleteAccount = async () => {
    if (!window.authAPI?.deleteAccount) {
      setDeleteError('Account deletion not available');
      return;
    }
    
    setDeleteLoading(true);
    setDeleteError(null);
    
    try {
      const result = await window.authAPI.deleteAccount();
      if (result.error) {
        setDeleteError(result.error);
        setDeleteLoading(false);
      } else {
        await supabase?.auth.signOut();
        setShowDeleteModal(false);
        setSession(null);
      }
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('An unexpected error occurred');
      setDeleteLoading(false);
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

  // Handler for clearing screenshot hotkey
  const handleClearScreenshotHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ screenshot: '' });
      setClipboardHotkeys(prev => ({ ...prev, screenshot: '' }));
    } catch (err) {
      console.error('Failed to clear screenshot hotkey:', err);
    }
  }, []);
  
  // Handler for setting full screen screenshot hotkey
  const handleSetFullScreenHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingFullScreenHotkey(false);
    setHotkeyError(null);

    if (!window.clipboardAPI) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ fullScreen: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register full screen screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, fullScreen: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set full screen screenshot hotkey');
      console.error('Failed to set full screen screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing full screen screenshot hotkey
  const handleClearFullScreenHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ fullScreen: '' });
      setClipboardHotkeys(prev => ({ ...prev, fullScreen: '' }));
    } catch (err) {
      console.error('Failed to clear full screen screenshot hotkey:', err);
    }
  }, []);

  // Handler for setting active window screenshot hotkey
  const handleSetActiveWindowHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingActiveWindowHotkey(false);
    setHotkeyError(null);

    if (!window.clipboardAPI) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ activeWindow: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register active window screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, activeWindow: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set active window screenshot hotkey');
      console.error('Failed to set active window screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing active window screenshot hotkey
  const handleClearActiveWindowHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ activeWindow: '' });
      setClipboardHotkeys(prev => ({ ...prev, activeWindow: '' }));
    } catch (err) {
      console.error('Failed to clear active window screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing all screenshot hotkeys (use Mac defaults)
  const handleClearAllScreenshotHotkeys = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ screenshot: '', fullScreen: '', activeWindow: '' });
      setClipboardHotkeys(prev => ({ ...prev, screenshot: '', fullScreen: '', activeWindow: '' }));
    } catch (err) {
      console.error('Failed to clear screenshot hotkeys:', err);
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

  // Handler for setting Super Paste hotkey
  const handleSetSuperPasteHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingSuperPasteHotkey(false);
    setHotkeyError(null);

    if (!window.hotkeyAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const result = await window.hotkeyAPI.setHotkey('superPaste', hotkeyString);
      if (!result.success) {
        setHotkeyError(result.error || 'Failed to register Super Paste hotkey.');
      } else {
        setSuperPasteHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Super Paste hotkey');
      console.error('Failed to set Super Paste hotkey:', err);
    }
  }, []);

  // Handler for setting Command Launcher hotkey
  const handleSetCommandLauncherHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingCommandLauncherHotkey(false);
    setHotkeyError(null);

    if (!window.hotkeyAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const result = await window.hotkeyAPI.setHotkey('commandLauncher', hotkeyString);
      if (!result.success) {
        setHotkeyError(result.error || 'Failed to register Command Launcher hotkey.');
      } else {
        setCommandLauncherHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Command Launcher hotkey');
      console.error('Failed to set Command Launcher hotkey:', err);
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

  // Handler for setting secondary transcription hotkey
  const handleSetSecondaryTranscriptionHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingSecondaryTranscriptionHotkey(false);
    setHotkeyError(null);

    if (!window.transcribeAPI?.setSecondaryHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.transcribeAPI.setSecondaryHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register secondary hotkey. It may be in use by another application.');
      } else {
        setSecondaryTranscriptionHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set secondary hotkey');
      console.error('Failed to set secondary hotkey:', err);
    }
  }, []);

  // Handler for clearing secondary transcription hotkey
  const handleClearSecondaryHotkey = useCallback(async () => {
    if (!window.transcribeAPI?.setSecondaryHotkey) return;

    try {
      await window.transcribeAPI.setSecondaryHotkey(null);
      setSecondaryTranscriptionHotkey(null);
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to clear secondary hotkey');
      console.error('Failed to clear secondary hotkey:', err);
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
      : isCapturingFullScreenHotkey ? 'fullScreen'
      : isCapturingActiveWindowHotkey ? 'activeWindow'
      : isCapturingContinuousContextHotkey ? 'continuousContext'
      : isCapturingTodoHotkey ? 'todo'
      : isCapturingTranscriptionHotkey ? 'transcription'
      : isCapturingSecondaryTranscriptionHotkey ? 'secondaryTranscription'
      : isCapturingAbandonHotkey ? 'abandon'
      : isCapturingSuperPasteHotkey ? 'superPaste'
      : isCapturingCommandLauncherHotkey ? 'commandLauncher'
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
        } else if (capturing === 'fullScreen') {
          handleSetFullScreenHotkey(hotkeyString);
        } else if (capturing === 'activeWindow') {
          handleSetActiveWindowHotkey(hotkeyString);
        } else if (capturing === 'todo') {
          handleSetTodoHotkey(hotkeyString);
        } else if (capturing === 'transcription') {
          handleSetTranscriptionHotkey(hotkeyString);
        } else if (capturing === 'secondaryTranscription') {
          handleSetSecondaryTranscriptionHotkey(hotkeyString);
        } else if (capturing === 'abandon') {
          handleSetAbandonHotkey(hotkeyString);
        } else if (capturing === 'superPaste') {
          handleSetSuperPasteHotkey(hotkeyString);
        } else if (capturing === 'commandLauncher') {
          handleSetCommandLauncherHotkey(hotkeyString);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCapturingScreenshotHotkey, isCapturingHistoryHotkey, isCapturingFullScreenHotkey, isCapturingActiveWindowHotkey, isCapturingContinuousContextHotkey, isCapturingTodoHotkey, isCapturingTranscriptionHotkey, isCapturingSecondaryTranscriptionHotkey, isCapturingAbandonHotkey, isCapturingSuperPasteHotkey, isCapturingCommandLauncherHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey, handleSetFullScreenHotkey, handleSetActiveWindowHotkey, handleSetContinuousContextHotkey, handleSetTodoHotkey, handleSetTranscriptionHotkey, handleSetSecondaryTranscriptionHotkey, handleSetAbandonHotkey, handleSetSuperPasteHotkey, handleSetCommandLauncherHotkey]);

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

      {/* Appearance Section - Dark mode toggle, accent colors, intensity */}
      <div style={styles.section}>
        <SectionHeader title="Appearance" />
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Dark Mode</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Switch between light and dark themes
            </span>
          </div>
          <button
            onClick={toggleDarkMode}
            style={{ ...styles.toggle, backgroundColor: theme.isDark ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: theme.isDark ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        {/* Accent Color Presets */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Accent Color</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Personalize your interface
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(Object.keys(accentPresets) as AccentPreset[]).map((preset) => {
              const isSelected = preset === accentPreset;
              const color = theme.isDark ? accentPresets[preset].dark : accentPresets[preset].light;
              return (
                <button
                  key={preset}
                  onClick={() => setAccentPreset(preset)}
                  title={accentPresets[preset].name}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    border: isSelected ? `2px solid ${theme.text}` : `2px solid transparent`,
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.15s',
                    transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                    boxShadow: isSelected ? `0 0 0 2px ${theme.bg}` : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Dark Mode Intensity Slider - only show when dark mode is enabled */}
        {theme.isDark && (
          <div style={styles.row}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
              <span style={styles.rowLabel}>Dark Mode Intensity</span>
              <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                Adjust background darkness
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', color: theme.textSecondary, width: '50px' }}>Lighter</span>
              <input
                type="range"
                min="0"
                max="100"
                value={darkModeIntensity}
                onChange={(e) => setDarkModeIntensity(parseInt(e.target.value, 10))}
                style={{
                  width: '100px',
                  height: '4px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${darkModeIntensity}%, ${theme.border} ${darkModeIntensity}%, ${theme.border} 100%)`,
                  borderRadius: '2px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{ fontSize: '11px', color: theme.textSecondary, width: '50px', textAlign: 'right' }}>Darker</span>
            </div>
          </div>
        )}
      </div>

      {/* System Access Section - Permission status with quick links to settings */}
      {systemPermissions && (
        <div style={styles.section}>
          <SectionHeader title="System Access" />
          
          {/* Microphone */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.microphone === 'granted' ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Microphone</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')}
              style={styles.linkBtn}
            >
              {systemPermissions.microphone === 'granted' ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
          
          {/* Accessibility */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.accessibility ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Accessibility</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')}
              style={styles.linkBtn}
            >
              {systemPermissions.accessibility ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
          
          {/* Screen Recording */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.screenRecording ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Screen Recording</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')}
              style={styles.linkBtn}
            >
              {systemPermissions.screenRecording ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
        </div>
      )}

      {/* Auto-Improve Transcripts Section */}
      <div style={styles.section}>
        <SectionHeader title="Auto-Improve Transcripts" />

        {/* Auto-Improve Toggle */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Auto-Improve</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Automatically enhance transcripts with AI
            </span>
          </div>
          <button
            onClick={() => handleAutoImproveChange(!autoImprove)}
            style={{ ...styles.toggle, backgroundColor: autoImprove ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: autoImprove ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        {/* Settings shown when auto-improve is enabled */}
        {autoImprove && (
          <>
            {/* Minimum words slider */}
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', color: theme.text }}>Minimum words to improve</span>
                <span style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>{autoImproveMinWords} words</span>
              </div>
              <input
                type="range"
                min="0"
                max="500"
                step="10"
                value={autoImproveMinWords}
                onChange={(e) => handleAutoImproveMinWordsChange(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: `linear-gradient(to right, ${theme.success} 0%, ${theme.success} ${(autoImproveMinWords / 500) * 100}%, ${theme.border} ${(autoImproveMinWords / 500) * 100}%, ${theme.border} 100%)`,
                  appearance: 'none',
                  cursor: 'pointer',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>0</span>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>500</span>
              </div>
            </div>

            {/* Method Selector - API vs Local */}
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: theme.text }}>Method</span>
                <div style={{
                  display: 'flex',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: `1px solid ${theme.border}`,
                }}>
                  <button
                    onClick={() => handleUseLocalLLMChange(false)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: !useLocalLLM ? theme.accent : 'transparent',
                      color: !useLocalLLM ? '#fff' : theme.text,
                      transition: 'background-color 0.2s',
                    }}
                  >
                    API
                  </button>
                  <button
                    onClick={() => handleUseLocalLLMChange(true)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      border: 'none',
                      borderLeft: `1px solid ${theme.border}`,
                      cursor: 'pointer',
                      backgroundColor: useLocalLLM ? theme.accent : 'transparent',
                      color: useLocalLLM ? '#fff' : theme.text,
                      transition: 'background-color 0.2s',
                    }}
                  >
                    Local
                  </button>
                </div>
              </div>

              {/* API Mode - show API key input */}
              {!useLocalLLM && (
                <div style={{ marginTop: '8px' }}>
                  {hasApiKey ? (
                    <>
                      <div style={styles.row}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            ...styles.statusDot,
                            backgroundColor: apiKeyTestResult?.success ? theme.success : (apiKeyTestResult?.success === false ? theme.error : '#9ca3af'),
                          }} />
                          <span style={{ fontSize: '13px', color: theme.textSecondary }}>{maskedApiKey || '•••••••'}</span>
                          {detectedProvider !== 'unknown' && (
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                              backgroundColor: theme.accent,
                              color: '#fff',
                              textTransform: 'capitalize' as const,
                            }}>
                              {detectedProvider}
                            </span>
                          )}
                        </div>
                        <div style={styles.rowControls}>
                          <button
                            onClick={handleTestApiKey}
                            disabled={apiKeyTesting}
                            style={styles.linkBtn}
                          >
                            {apiKeyTesting ? 'Testing...' : 'Test'}
                          </button>
                          <button
                            onClick={handleClearApiKey}
                            style={{ ...styles.linkBtn, color: theme.error }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {apiKeyTestResult && (
                        <p style={{
                          fontSize: '12px',
                          color: apiKeyTestResult.success ? theme.success : theme.error,
                          margin: '4px 0 0 16px',
                        }}>
                          {apiKeyTestResult.success ? 'Connected' : apiKeyTestResult.error}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder="Paste API key"
                          style={{
                            ...styles.input,
                            flex: 1,
                            minWidth: 0,
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveApiKey();
                          }}
                        />
                        <button
                          onClick={handleSaveApiKey}
                          disabled={apiKeySaving || !apiKeyInput.trim()}
                          style={{
                            ...styles.btn,
                            backgroundColor: apiKeyInput.trim() ? theme.accent : undefined,
                            color: apiKeyInput.trim() ? '#fff' : undefined,
                            border: apiKeyInput.trim() ? 'none' : undefined,
                            opacity: apiKeySaving || !apiKeyInput.trim() ? 0.5 : 1,
                          }}
                        >
                          {apiKeySaving ? '...' : 'Save'}
                        </button>
                      </div>
                      {apiKeyError && <p style={styles.error}>{apiKeyError}</p>}
                    </>
                  )}
                  {/* Fallback note */}
                  {Object.values(localLLMStatus).some(Boolean) && (
                    <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '8px' }}>
                      Falls back to local model if offline
                    </p>
                  )}
                </div>
              )}

              {/* Local Mode - show model download */}
              {useLocalLLM && (() => {
                const modelId = 'llama-3.2-1b';
                const model = localLLMModels[modelId];
                if (!model) return null;
                const isDownloaded = localLLMStatus[modelId] || false;
                const isDownloading = downloadingLocalLLM === modelId;
                const sizeMB = Math.round(model.sizeBytes / 1024 / 1024);
                const progressPercent = localLLMProgress && isDownloading
                  ? Math.round((localLLMProgress.downloaded / localLLMProgress.total) * 100)
                  : 0;

                return (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: `1px solid ${theme.border}`,
                      backgroundColor: 'transparent',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                          {model.name}
                        </span>
                        <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                          {sizeMB}MB {isDownloaded && '· Downloaded'}
                        </span>
                      </div>

                      <div style={styles.rowControls}>
                        {isDownloading && localLLMProgress ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '60px',
                              height: '4px',
                              backgroundColor: theme.border,
                              borderRadius: '2px',
                              overflow: 'hidden',
                            }}>
                              <div style={{
                                width: `${progressPercent}%`,
                                height: '100%',
                                backgroundColor: theme.info,
                                transition: 'width 0.3s',
                              }} />
                            </div>
                            <span style={{ fontSize: '11px', color: theme.textSecondary }}>{progressPercent}%</span>
                          </div>
                        ) : isDownloaded ? (
                          <button
                            onClick={() => handleDeleteLocalLLM(modelId)}
                            style={{ ...styles.linkBtn, color: '#9ca3af' }}
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDownloadLocalLLM(modelId)}
                            disabled={downloadingLocalLLM !== null}
                            style={{
                              ...styles.btn,
                              opacity: downloadingLocalLLM !== null ? 0.5 : 1,
                            }}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '8px', marginBottom: 0 }}>
                      Experimental feature. Results may vary.
                    </p>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Keyboard Shortcuts Section - First for easy access */}
      <div style={styles.section}>
        <SectionHeader title="Keyboard Shortcuts" />
        
        {/* Open Field Theory - primary action, shown first */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Open Field Theory</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingHistoryHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
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
          <span style={styles.rowLabel}>Record Transcription</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingTranscriptionHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingTranscriptionHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingTranscriptionHotkey ? 'Press keys...' : transcriptionHotkey}
            </button>
            {isCapturingTranscriptionHotkey && (
              <button onClick={() => { setIsCapturingTranscriptionHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Secondary Transcription Hotkey */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Record Transcription (Alt)</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingSecondaryTranscriptionHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingSecondaryTranscriptionHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingSecondaryTranscriptionHotkey ? 'Press keys...' : (secondaryTranscriptionHotkey || 'Not set')}
            </button>
            {isCapturingSecondaryTranscriptionHotkey && (
              <button onClick={() => { setIsCapturingSecondaryTranscriptionHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
            {!isCapturingSecondaryTranscriptionHotkey && secondaryTranscriptionHotkey && (
              <button onClick={handleClearSecondaryHotkey} style={styles.btnGhost}>Clear</button>
            )}
          </div>
        </div>

        {/* Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingScreenshotHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingScreenshotHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingScreenshotHotkey ? 'Press keys...' : clipboardHotkeys.screenshot || 'Not set'}
            </button>
            {isCapturingScreenshotHotkey && (
              <button onClick={() => { setIsCapturingScreenshotHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
            {!isCapturingScreenshotHotkey && clipboardHotkeys.screenshot && (
              <button onClick={handleClearScreenshotHotkey} style={styles.btnGhost}>Clear</button>
            )}
          </div>
        </div>

        {/* Full Screen Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Full Screen Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingFullScreenHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingFullScreenHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingFullScreenHotkey ? 'Press keys...' : clipboardHotkeys.fullScreen || 'Not set'}
            </button>
            {isCapturingFullScreenHotkey && (
              <button onClick={() => { setIsCapturingFullScreenHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
            {!isCapturingFullScreenHotkey && clipboardHotkeys.fullScreen && (
              <button onClick={handleClearFullScreenHotkey} style={styles.btnGhost}>Clear</button>
            )}
          </div>
        </div>

        {/* Active Window Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Active Window Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingActiveWindowHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey}
              style={{ ...styles.btn, ...(isCapturingActiveWindowHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingActiveWindowHotkey ? 'Press keys...' : clipboardHotkeys.activeWindow || 'Not set'}
            </button>
            {isCapturingActiveWindowHotkey && (
              <button onClick={() => { setIsCapturingActiveWindowHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
            {!isCapturingActiveWindowHotkey && clipboardHotkeys.activeWindow && (
              <button onClick={handleClearActiveWindowHotkey} style={styles.btnGhost}>Clear</button>
            )}
          </div>
        </div>

        {/* Clear all screenshot shortcuts helper */}
        {(clipboardHotkeys.screenshot || clipboardHotkeys.fullScreen || clipboardHotkeys.activeWindow) && (
          <div style={{ marginTop: '-4px', marginBottom: '8px', paddingLeft: '12px' }}>
            <button
              onClick={handleClearAllScreenshotHotkeys}
              style={{
                ...styles.btnGhost,
                fontSize: '11px',
                color: theme.textSecondary,
                padding: '2px 0',
              }}
            >
              Clear all screenshot shortcuts (use Mac defaults)
            </button>
          </div>
        )}

        {/* Super Paste - Smart context-aware paste */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>
            Super Paste
            <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
              (pastes last stack or smart clipboard)
            </span>
          </span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingSuperPasteHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey || isCapturingSuperPasteHotkey || isCapturingCommandLauncherHotkey}
              style={{ ...styles.btn, ...(isCapturingSuperPasteHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingSuperPasteHotkey ? 'Press keys...' : (superPasteHotkey || 'Not set')}
            </button>
            {isCapturingSuperPasteHotkey && (
              <button onClick={() => { setIsCapturingSuperPasteHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Command Launcher */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>
            Command Launcher
            <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
              (quick access to commands)
            </span>
          </span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingCommandLauncherHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingFullScreenHotkey || isCapturingActiveWindowHotkey || isCapturingTodoHotkey || isCapturingTranscriptionHotkey || isCapturingSecondaryTranscriptionHotkey || isCapturingSuperPasteHotkey || isCapturingCommandLauncherHotkey}
              style={{ ...styles.btn, ...(isCapturingCommandLauncherHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingCommandLauncherHotkey ? 'Press keys...' : (commandLauncherHotkey || 'Not set')}
            </button>
            {isCapturingCommandLauncherHotkey && (
              <button onClick={() => { setIsCapturingCommandLauncherHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Sounds toggle moved to Audio section */}

        {/* Show in Dock - WIP feature, hidden until ready */}
        {/* Permission Reminders - removed, always show until permissions granted */}
        {/* Cursor Status Indicator - removed, always show the dot */}

        {/* Hide Status Labels */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Hide Status Text</span>
            <span style={styles.rowHint}>Show only colored dots without text labels</span>
          </div>
          <div style={styles.rowControls}>
            <button
              onClick={() => handleToggleHideStatusLabels(!hideStatusLabels)}
              style={{ ...styles.toggle, backgroundColor: hideStatusLabels ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: hideStatusLabels ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>
        
        {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}
      </div>

      {/* Audio Section */}
      <div style={styles.section}>
        <SectionHeader title="Audio" />
        <AudioSettingsPanel />
        
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
      </div>

      {/* Transcription Section */}
      <div style={styles.section}>
        <SectionHeader title="Transcription" />
        <TranscriptionSettings />
      </div>

      {/* Portable Commands Section */}
      <div style={styles.section}>
        <SectionHeader title="Portable Commands" />
        <CommandsSettings />
      </div>

      {/* Support Section - diagnostics and troubleshooting */}
      <div style={styles.section}>
        <SectionHeader title="Support" />
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Launch on Login</span>
            <span style={styles.rowHint}>Start Field Theory when you log in</span>
          </div>
          <label style={styles.toggleContainer}>
            <input
              type="checkbox"
              checked={launchAtLogin}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setLaunchAtLogin(enabled);
                await window.clipboardAPI?.setLaunchAtLogin?.(enabled);
              }}
              style={styles.toggleInput}
            />
            <span style={styles.toggleSlider} />
          </label>
        </div>
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Diagnostics</span>
            <span style={styles.rowHint}>View system info for troubleshooting</span>
          </div>
          <button
            onClick={() => setShowDiagnostics(true)}
            style={styles.linkBtn}
          >
            View
          </button>
        </div>
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Restart Onboarding</span>
            <span style={styles.rowHint}>Go through the setup flow again</span>
          </div>
          <button
            onClick={() => window.onboardingAPI?.reset?.()}
            style={styles.linkBtn}
          >
            Start
          </button>
        </div>
      </div>
      
      {/* Account Section - combines account info and subscription */}
      {(() => {
        // Only trust cached 'pro' tier if user is actually signed in.
        const displayTier = session ? userTier : 'free';
        const tierDisplayName = displayTier === 'pro' ? 'Pro Plan' : 'Basic Plan';
        
        // Get display name from user metadata, fallback to email.
        const userFullName = session?.user?.user_metadata?.full_name as string | undefined;
        const userEmail = session?.user?.email;
        
        return (
          <div style={styles.section}>
            <SectionHeader title="Account" />
            
            {session ? (
              <>
                {/* User info row with sign out - name + email stacked */}
                <div style={styles.row}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={styles.rowValue}>
                      {userFullName || userEmail}
                    </span>
                    {userFullName && userEmail && (
                      <span style={{ fontSize: '12px', color: theme.textSecondary }}>
                        {userEmail}
                      </span>
                    )}
                  </div>
                  <button 
                    onClick={handleSignOut} 
                    disabled={authLoading} 
                    style={styles.linkBtn}
                  >
                    {authLoading ? '...' : 'Sign out'}
                  </button>
                </div>
                
                {syncStatus && <p style={styles.syncStatusText}>{syncStatus}</p>}
                
                {/* Subscription row */}
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
                      {displayTier === 'pro'
                        ? 'Unlimited priority mic and auto-stacking.'
                        : quotaUsage
                          ? `${quotaUsage.priorityMic} · ${quotaUsage.autoStack}`
                          : 'Upgrade for unlimited priority mic and auto-stacking.'}
                    </p>
                  </div>
                  <div style={styles.rowControls}>
                    {displayTier === 'free' ? (
                      <button 
                        onClick={() => {
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
                
                {/* Delete account link */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.border}` }}>
                  <button
                    onClick={() => {
                      setShowDeleteModal(true);
                      setDeleteConfirmEmail('');
                      setDeleteError(null);
                    }}
                    style={{
                      ...styles.linkBtn,
                      color: theme.error,
                      fontSize: '12px',
                    }}
                  >
                    Delete Account
                  </button>
                </div>
              </>
            ) : (
              // Not signed in - show sign in button.
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={styles.row}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={styles.rowLabel}>Current Plan</span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 600,
                        backgroundColor: theme.bgSecondary,
                        color: theme.textSecondary,
                      }}>
                        Basic Plan
                      </span>
                    </div>
                    <p style={styles.rowHint}>
                      {quotaUsage
                        ? `${quotaUsage.priorityMic} · ${quotaUsage.autoStack}`
                        : 'Limited priority mic and auto-stacking.'}
                    </p>
                  </div>
                  <button
                    onClick={onNavigateToSignIn}
                    style={styles.linkBtn}
                  >
                    Sign in
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}
      
      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !deleteLoading && setShowDeleteModal(false)}
        >
          <div
            style={{
              backgroundColor: theme.bg,
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600, color: theme.text }}>
              Delete Account / Cancel Subscription
            </h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: theme.textSecondary, lineHeight: 1.5 }}>
              This will permanently delete:
            </p>
            <ul style={{ margin: '0 0 12px 0', paddingLeft: '20px', fontSize: '13px', color: theme.textSecondary, lineHeight: 1.6 }}>
              <li>Your account and profile</li>
              <li>All shared items</li>
              {userTier === 'pro' && <li>Any existing Pro subscription ($14/month)</li>}
            </ul>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5 }}>
              <strong>Important:</strong> You may continue to use the Basic plan without an account. 
              All local screenshots, transcripts, and drawings will remain on your machine.
            </p>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: theme.error, fontWeight: 500 }}>
              This cannot be undone.
            </p>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: theme.textSecondary, marginBottom: '6px' }}>
                Type your email to confirm:
              </label>
              <input
                type="email"
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={session?.user?.email || ''}
                disabled={deleteLoading}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '13px',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  backgroundColor: theme.bgSecondary,
                  color: theme.text,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            
            {deleteError && (
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.error }}>
                {deleteError}
              </p>
            )}
            
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteLoading}
                style={{
                  ...styles.btn,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || deleteConfirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase()}
                style={{
                  ...styles.btn,
                  backgroundColor: theme.error,
                  color: '#fff',
                  border: 'none',
                  opacity: deleteLoading || deleteConfirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase() ? 0.5 : 1,
                }}
              >
                {deleteLoading ? 'Deleting...' : userTier === 'pro' ? 'Delete and Cancel' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Diagnostics Modal */}
      <DiagnosticsModal 
        isOpen={showDiagnostics} 
        onClose={() => setShowDiagnostics(false)}
        onSendAsFeedback={onNavigateToFeedback}
      />
    </div>
  );
}

// Styles consistent with ClipboardHistory styling
const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
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
    color: theme.textSecondary,
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
    color: theme.text,
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
    color: theme.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: theme.border,
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
    color: theme.text,
    fontWeight: 400,
  },
  rowValue: {
    fontSize: '13px',
    color: theme.text,
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rowHint: {
    fontSize: '13px',
    color: theme.textSecondary,
    fontWeight: 400,
  },

  // Unified button styles
  btn: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: theme.accent,
    color: '#fff',
    borderColor: theme.accent,
  },
  btnDanger: {
    color: theme.error,
    borderColor: theme.isDark ? 'rgba(248,113,113,0.3)' : '#fecaca',
    backgroundColor: theme.errorBg,
  },
  btnSuccess: {
    color: '#fff',
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    minWidth: 'auto',
    padding: '6px 8px',
  },
  linkBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    fontSize: '13px',
    padding: '4px 0',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
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
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '160px',
  },

  // Input field
  input: {
    padding: '6px 12px',
    fontSize: '13px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
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
  statusGreen: { backgroundColor: theme.success },
  statusYellow: { backgroundColor: theme.warning },
  statusRed: { backgroundColor: theme.error },
  statusGray: { backgroundColor: theme.textSecondary },

  // Error text
  error: {
    fontSize: '13px',
    color: theme.error,
    marginTop: '4px',
  },

  // Model list (compact)
  modelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: `1px solid ${theme.border}`,
  },
  modelName: {
    fontSize: '13px',
    color: theme.text,
  },
  modelSize: {
    fontSize: '13px',
    color: theme.textSecondary,
    marginLeft: '8px',
  },

  // Permissions warning (compact)
  permissionsWarning: {
    backgroundColor: theme.warningBg,
    border: `1px solid ${theme.warning}`,
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
    color: theme.isDark ? theme.warning : '#92400e',
    margin: 0,
  },
  permissionsButton: {
    padding: '6px 12px',
    backgroundColor: theme.warning,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
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
    color: theme.text,
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
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  hotkeyButtonActive: {
    backgroundColor: theme.accent,
    color: '#fff',
    borderColor: theme.accent,
  },
  cancelButton: {
    padding: '6px 8px',
    fontSize: '13px',
    color: theme.textSecondary,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  hotkeyError: {
    fontSize: '13px',
    color: theme.error,
    marginTop: '4px',
  },
  loginInput: {
    padding: '8px 12px',
    fontSize: '13px',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    color: theme.text,
  },
  loginButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: theme.accent,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  signOutButton: {
    padding: '6px 12px',
    fontSize: '13px',
    color: theme.textSecondary,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
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
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  fixButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: theme.textSecondary,
    backgroundColor: theme.isDark ? theme.surface1 : '#f9fafb',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncStatusText: {
    fontSize: '13px',
    color: theme.textSecondary,
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
});
