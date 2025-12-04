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


