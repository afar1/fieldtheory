// Data models for the app

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export interface Observation {
  id: string;
  text: string;
  createdAt: number;
}

export interface Settings {
  autoStart: boolean;
  anthropicKey?: string; // Optional override for API key
}

export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: number;
}


