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

export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}


