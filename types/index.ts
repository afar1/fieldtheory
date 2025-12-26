// Data models for the app

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
  anthropicKey?: string; // Optional override for API key
  
  // Feature visibility toggles - when false, the tab button is hidden
  showTodos: boolean;
  showObservations: boolean;
  showCursor: boolean;
  
  // Auto-separation toggle - when true, transcriptions are automatically processed
  // into tasks and observations. When false, user must manually tap "Separate".
  autoSeparate: boolean;
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
 * Sketch entry - represents a one-shot drawing captured on iOS.
 * The sketch is immediately finalized into a PNG image (immutable, no later editing).
 * Syncs to Mac clipboard history so it can be pasted into context.
 */
export interface SketchEntry {
  id: string;
  
  // Local file URI for the PNG image (file:///... path).
  localUri: string;
  
  // Remote URL after upload to Supabase Storage (optional until synced).
  remoteUrl?: string;
  
  // Image dimensions (for proper display and layout).
  width: number;
  height: number;
  
  // File size in bytes.
  bytes: number;
  
  // SHA256 hash for deduplication and integrity checks.
  sha256?: string;
  
  // Optional caption/title for the sketch.
  title?: string;
  
  // Timestamps for sync ordering.
  createdAt: number;
  updatedAt: number;
  
  // Sync status - tracks whether the sketch has been uploaded.
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}


