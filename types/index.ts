// Data models for the app

// Re-export tier types and constants.
export * from './tiers';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Observation {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  autoStart: boolean;

  // Feature visibility toggles - when false, the tab button is hidden
  showTodos: boolean;
  showLibrary: boolean;

  // Auto-separation toggle - when true, transcriptions are automatically processed
  // into tasks and observations. When false, user must manually tap "Separate".
  autoSeparate: boolean;
}

export interface LibraryDocument {
  id: string;
  title: string;
  content: string;
  folderPath?: string;
  fileName?: string;
  sourceKind?: 'mobile' | 'laptop';
  tags?: string[];
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryTombstone {
  id: string;
  sourcePath: string;
  createdAt: number;
  deletedAt: number;
}

export interface LibraryViewState {
  selectedDocumentId?: string | null;
  recentDocumentIds?: string[];
  readerScrollOffsets?: Record<string, number>;
  updatedAt: number;
}

export type SyncTombstoneCollection = 'todos' | 'observations' | 'transcripts';

export interface SyncTombstone {
  collection: SyncTombstoneCollection;
  id: string;
  deletedAt: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  stackSegments?: TranscriptSegment[];
}

/**
 * Command entry - portable command synced from Mac app.
 * These are markdown files from watched directories that have mobile sync enabled.
 * Users can invoke commands by voice ("use the review command") and the full
 * command content is expanded inline in the clipboard output.
 */
export interface Command {
  id: string;
  name: string;           // Lowercase command name (e.g., "review")
  displayName: string;    // Human-readable name (e.g., "Review")
  content: string;        // Full markdown content
  updatedAt: number;      // For change detection
}

/**
 * Result of detecting commands in transcribed text.
 */
export interface CommandDetectionResult {
  detected: boolean;
  commandNames: string[];
  matchedCommands: Command[];
  unmatchedNames: string[];
  textWithoutCommandRefs: string;
}
