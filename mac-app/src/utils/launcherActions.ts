/**
 * Launcher Actions - Core functions available in the Cmd+K command launcher.
 * Each action has a human-readable name, keywords for matching, and a hotkey.
 * Hotkeys are fetched live from the relevant APIs so they update when changed.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatHotkeyDisplay } from './hotkeys';

// =============================================================================
// Types
// =============================================================================

export type LauncherActionId = 
  | 'settings'
  | 'field-theory'
  | 'take-screenshot'
  | 'full-screen-screenshot'
  | 'active-window-screenshot'
  | 'super-paste'
  | 'start-recording'
  | 'toggle-tasks'
  | 'open-history';

export interface LauncherAction {
  id: LauncherActionId;
  name: string;
  // Keywords for fuzzy matching - includes the name words plus any aliases.
  keywords: string[];
  // Display hotkey (formatted with ⌘ ⇧ etc).
  hotkeyDisplay: string;
  // Raw hotkey string (e.g., "Command+Shift+4").
  hotkeyRaw: string;
  // Icon for visual identification (optional).
  icon?: string;
  // Function to execute this action.
  execute: () => void | Promise<void>;
}

export interface LauncherCommand {
  id: string;
  name: string;
  content: string;
  copyCount: number;
}

// =============================================================================
// Default Hotkeys (used before live values are loaded)
// =============================================================================

const DEFAULT_HOTKEYS = {
  screenshot: 'Shift+Command+4',
  fullScreen: 'Command+3',
  activeWindow: 'Shift+Command+3',
  history: 'Option+Space',
  transcription: 'Command+\\',
  tasks: 'Shift+Command+T',
  superPaste: 'Shift+Command+V',
};

// =============================================================================
// Hook: useLauncherActions
// Fetches live hotkey values and provides a list of executable actions.
// =============================================================================

export function useLauncherActions(
  onAction?: (actionId: LauncherActionId) => void
): {
  actions: LauncherAction[];
  loading: boolean;
  executeAction: (action: LauncherAction) => void;
} {
  const [hotkeys, setHotkeys] = useState<{
    screenshot: string;
    fullScreen: string;
    activeWindow: string;
    history: string;
    transcription: string;
    tasks: string;
    superPaste: string;
  }>(DEFAULT_HOTKEYS);
  
  const [loading, setLoading] = useState(true);

  // Load hotkeys from the APIs on mount.
  useEffect(() => {
    let cancelled = false;

    async function loadHotkeys() {
      try {
        const results = await Promise.all([
          // Clipboard hotkeys (screenshot, fullScreen, activeWindow, history).
          window.clipboardAPI?.getHotkeys?.() ?? {},
          // Transcription hotkey.
          window.transcribeAPI?.getHotkey?.() ?? DEFAULT_HOTKEYS.transcription,
          // Todo/tasks hotkey.
          window.todoAPI?.getHotkey?.() ?? DEFAULT_HOTKEYS.tasks,
        ]);

        if (cancelled) return;

        const clipboardHotkeys = results[0] as { 
          screenshot?: string; 
          fullScreen?: string; 
          activeWindow?: string; 
          history?: string;
        };
        const transcriptionHotkey = results[1] as string;
        const tasksHotkey = results[2] as string;

        setHotkeys({
          screenshot: clipboardHotkeys.screenshot || DEFAULT_HOTKEYS.screenshot,
          fullScreen: clipboardHotkeys.fullScreen || DEFAULT_HOTKEYS.fullScreen,
          activeWindow: clipboardHotkeys.activeWindow || DEFAULT_HOTKEYS.activeWindow,
          history: clipboardHotkeys.history || DEFAULT_HOTKEYS.history,
          transcription: transcriptionHotkey || DEFAULT_HOTKEYS.transcription,
          tasks: tasksHotkey || DEFAULT_HOTKEYS.tasks,
          superPaste: DEFAULT_HOTKEYS.superPaste, // This one isn't configurable yet.
        });
      } catch (err) {
        console.error('[LauncherActions] Failed to load hotkeys:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHotkeys();

    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to hotkey changes.
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Listen for transcription hotkey changes.
    if (window.transcribeAPI?.onHotkeyChanged) {
      const unsub = window.transcribeAPI.onHotkeyChanged((newHotkey) => {
        setHotkeys(prev => ({ ...prev, transcription: newHotkey }));
      });
      unsubscribers.push(unsub);
    }

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  // Execute an action and optionally notify the parent.
  const executeAction = useCallback((action: LauncherAction) => {
    action.execute();
    onAction?.(action.id);
  }, [onAction]);

  // Build the list of actions with current hotkey values.
  const actions: LauncherAction[] = useMemo(() => [
    {
      id: 'settings' as const,
      name: 'Open Settings',
      keywords: ['open', 'settings', 'preferences', 'config', 'configure'],
      hotkeyDisplay: '⌘ ,',
      hotkeyRaw: 'Command+,',
      icon: '⚙️',
      execute: () => {
        // Trigger settings view - this is handled by the parent component.
        onAction?.('settings');
      },
    },
    {
      id: 'field-theory' as const,
      name: 'Open Field Theory',
      keywords: ['open', 'field', 'theory', 'main', 'app', 'home'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.history),
      hotkeyRaw: hotkeys.history,
      icon: '🌀',
      execute: () => {
        // This opens the main Field Theory window - trigger via parent.
        onAction?.('field-theory');
      },
    },
    {
      id: 'take-screenshot' as const,
      name: 'Take Screenshot',
      keywords: ['take', 'screenshot', 'capture', 'screen', 'region', 'selection'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.screenshot),
      hotkeyRaw: hotkeys.screenshot,
      icon: '📸',
      execute: async () => {
        try {
          await window.clipboardAPI?.captureScreenshot?.(true);
        } catch (err) {
          console.error('[LauncherActions] Screenshot failed:', err);
        }
      },
    },
    {
      id: 'full-screen-screenshot' as const,
      name: 'Full Screen Screenshot',
      keywords: ['full', 'screen', 'screenshot', 'capture', 'entire', 'whole', 'desktop'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.fullScreen),
      hotkeyRaw: hotkeys.fullScreen,
      icon: '🖥️',
      execute: async () => {
        // The captureScreenshot API with region=false should do full screen.
        // However, looking at the codebase, full screen is a separate call.
        // We'll trigger via the parent since the API may need the full screen flag.
        onAction?.('full-screen-screenshot');
      },
    },
    {
      id: 'active-window-screenshot' as const,
      name: 'Active Window Screenshot',
      keywords: ['active', 'window', 'screenshot', 'capture', 'focused', 'current'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.activeWindow),
      hotkeyRaw: hotkeys.activeWindow,
      icon: '🪟',
      execute: () => {
        onAction?.('active-window-screenshot');
      },
    },
    {
      id: 'super-paste' as const,
      name: 'Super Paste',
      keywords: ['super', 'paste', 'smart', 'stack', 'quick'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.superPaste),
      hotkeyRaw: hotkeys.superPaste,
      icon: '📋',
      execute: () => {
        // Super paste is a global hotkey registered in main process.
        // We can't easily trigger it from renderer, so notify parent.
        onAction?.('super-paste');
      },
    },
    {
      id: 'start-recording' as const,
      name: 'Start Recording',
      keywords: ['start', 'recording', 'transcribe', 'transcription', 'voice', 'audio', 'dictate', 'dictation'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.transcription),
      hotkeyRaw: hotkeys.transcription,
      icon: '🎙️',
      execute: async () => {
        try {
          await window.transcribeAPI?.toggleRecording?.();
        } catch (err) {
          console.error('[LauncherActions] Toggle recording failed:', err);
        }
      },
    },
    {
      id: 'toggle-tasks' as const,
      name: 'Toggle Tasks',
      keywords: ['toggle', 'tasks', 'todos', 'todo', 'list', 'checklist'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.tasks),
      hotkeyRaw: hotkeys.tasks,
      icon: '✓',
      execute: () => {
        onAction?.('toggle-tasks');
      },
    },
    {
      id: 'open-history' as const,
      name: 'Open Clipboard History',
      keywords: ['open', 'clipboard', 'history', 'clips', 'copied', 'recent'],
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.history),
      hotkeyRaw: hotkeys.history,
      icon: '📜',
      execute: () => {
        onAction?.('open-history');
      },
    },
  ], [hotkeys, onAction]);

  return { actions, loading, executeAction };
}

// =============================================================================
// Helper: Match actions against a search query.
// Returns actions that have any keyword matching the query (case-insensitive).
// =============================================================================

export function matchActions(
  actions: LauncherAction[],
  query: string
): LauncherAction[] {
  if (!query.trim()) return [];
  
  const normalizedQuery = query.toLowerCase().trim();
  
  // Score each action based on how well it matches.
  const scored = actions.map(action => {
    let score = 0;
    
    // Check if any keyword starts with the query (highest priority).
    const startsWithMatch = action.keywords.some(kw => 
      kw.toLowerCase().startsWith(normalizedQuery)
    );
    if (startsWithMatch) score += 100;
    
    // Check if any keyword contains the query.
    const containsMatch = action.keywords.some(kw =>
      kw.toLowerCase().includes(normalizedQuery)
    );
    if (containsMatch) score += 50;
    
    // Check if the name contains the query.
    if (action.name.toLowerCase().includes(normalizedQuery)) {
      score += 75;
    }
    
    // Bonus for exact keyword match.
    const exactMatch = action.keywords.some(kw =>
      kw.toLowerCase() === normalizedQuery
    );
    if (exactMatch) score += 200;
    
    return { action, score };
  });
  
  // Filter to actions with any match, then sort by score descending.
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.action);
}
