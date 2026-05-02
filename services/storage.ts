import AsyncStorage from '@react-native-async-storage/async-storage';
import { Todo, Observation, Settings, TranscriptEntry, TranscriptSegment, LibraryDocument, LibraryTombstone } from '../types';

// Normalize saved records so new fields are always present.
const normalizeTodo = (raw: Todo): Todo => ({
  ...raw,
  updatedAt: raw.updatedAt ?? raw.createdAt,
});

const normalizeObservation = (raw: Observation): Observation => ({
  ...raw,
  updatedAt: raw.updatedAt ?? raw.createdAt,
});

const normalizeSegment = (segment: TranscriptSegment): TranscriptSegment => ({
  ...segment,
  updatedAt: segment.updatedAt ?? segment.createdAt,
});

const normalizeTranscript = (raw: TranscriptEntry): TranscriptEntry => ({
  ...raw,
  updatedAt: raw.updatedAt ?? raw.createdAt,
  stackSegments: raw.stackSegments?.map(normalizeSegment),
});

const normalizeLibraryDocument = (raw: LibraryDocument): LibraryDocument => ({
  ...raw,
  folderPath: raw.folderPath ?? 'scratchpad',
  fileName: raw.fileName ?? `${(raw.title.trim() || 'Untitled').replace(/[/:]/g, '-')}.md`,
  sourceKind: raw.sourceKind ?? 'mobile',
  tags: raw.tags ?? [],
  isPinned: raw.isPinned ?? false,
  updatedAt: raw.updatedAt ?? raw.createdAt,
});

const normalizeLibraryTombstone = (raw: LibraryTombstone): LibraryTombstone => ({
  ...raw,
  createdAt: raw.createdAt ?? raw.deletedAt,
  deletedAt: raw.deletedAt ?? raw.createdAt,
});

// Storage keys
const TODOS_KEY = '@littleai/todos';
const OBSERVATIONS_KEY = '@littleai/observations';
const SETTINGS_KEY = '@littleai/settings';
const TRANSCRIPTS_KEY = '@littleai/transcripts';
const LIBRARY_DOCUMENTS_KEY = '@littleai/library-documents';
const LIBRARY_TOMBSTONES_KEY = '@littleai/library-tombstones';

/**
 * Storage service for persisting todos, observations, and settings.
 * Uses AsyncStorage for local persistence.
 */
export class StorageService {
  /**
   * Load all todos from storage.
   */
  static async getTodos(): Promise<Todo[]> {
    try {
      const data = await AsyncStorage.getItem(TODOS_KEY);
      return data ? JSON.parse(data).map(normalizeTodo) : [];
    } catch (error) {
      console.error('Failed to load todos:', error);
      return [];
    }
  }

  /**
   * Save todos to storage.
   */
  static async saveTodos(todos: Todo[]): Promise<void> {
    try {
      await AsyncStorage.setItem(TODOS_KEY, JSON.stringify(todos));
    } catch (error) {
      console.error('Failed to save todos:', error);
      throw error;
    }
  }

  /**
   * Load all observations from storage.
   */
  static async getObservations(): Promise<Observation[]> {
    try {
      const data = await AsyncStorage.getItem(OBSERVATIONS_KEY);
      return data ? JSON.parse(data).map(normalizeObservation) : [];
    } catch (error) {
      console.error('Failed to load observations:', error);
      return [];
    }
  }

  /**
   * Save observations to storage.
   */
  static async saveObservations(observations: Observation[]): Promise<void> {
    try {
      await AsyncStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(observations));
    } catch (error) {
      console.error('Failed to save observations:', error);
      throw error;
    }
  }

  /**
   * Load settings from storage.
   * Merges stored settings with defaults to handle new settings added in updates.
   */
  static async getSettings(): Promise<Settings> {
    // Default settings - all features enabled by default
    const defaultSettings: Settings = {
      autoStart: false,
      showTodos: true,
      showLibrary: true,
      autoSeparate: true,
    };
    
    try {
      const data = await AsyncStorage.getItem(SETTINGS_KEY);
      if (data) {
        const stored = JSON.parse(data);
        // Merge stored settings with defaults so new fields get their default values
        return { ...defaultSettings, ...stored };
      }
      return defaultSettings;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return defaultSettings;
    }
  }

  /**
   * Save settings to storage.
   */
  static async saveSettings(settings: Settings): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Load all transcripts from storage.
   */
  static async getTranscripts(): Promise<TranscriptEntry[]> {
    try {
      const data = await AsyncStorage.getItem(TRANSCRIPTS_KEY);
      return data ? JSON.parse(data).map(normalizeTranscript) : [];
    } catch (error) {
      console.error('Failed to load transcripts:', error);
      return [];
    }
  }

  /**
   * Save transcripts to storage.
   */
  static async saveTranscripts(transcripts: TranscriptEntry[]): Promise<void> {
    try {
      await AsyncStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(transcripts));
    } catch (error) {
      console.error('Failed to save transcripts:', error);
      throw error;
    }
  }

  /**
   * Load Library documents from storage.
   */
  static async getLibraryDocuments(): Promise<LibraryDocument[]> {
    try {
      const data = await AsyncStorage.getItem(LIBRARY_DOCUMENTS_KEY);
      return data ? JSON.parse(data).map(normalizeLibraryDocument) : [];
    } catch (error) {
      console.error('Failed to load library documents:', error);
      return [];
    }
  }

  /**
   * Save Library documents to storage.
   */
  static async saveLibraryDocuments(documents: LibraryDocument[]): Promise<void> {
    try {
      await AsyncStorage.setItem(LIBRARY_DOCUMENTS_KEY, JSON.stringify(documents));
    } catch (error) {
      console.error('Failed to save library documents:', error);
      throw error;
    }
  }

  /**
   * Load pending Library tombstones that still need to be synced.
   */
  static async getLibraryTombstones(): Promise<LibraryTombstone[]> {
    try {
      const data = await AsyncStorage.getItem(LIBRARY_TOMBSTONES_KEY);
      return data ? JSON.parse(data).map(normalizeLibraryTombstone) : [];
    } catch (error) {
      console.error('Failed to load library tombstones:', error);
      return [];
    }
  }

  /**
   * Save pending Library tombstones.
   */
  static async saveLibraryTombstones(tombstones: LibraryTombstone[]): Promise<void> {
    try {
      await AsyncStorage.setItem(LIBRARY_TOMBSTONES_KEY, JSON.stringify(tombstones));
    } catch (error) {
      console.error('Failed to save library tombstones:', error);
      throw error;
    }
  }

  /**
   * Add pending Library tombstones, keeping the newest delete per document id.
   */
  static async addLibraryTombstones(tombstones: LibraryTombstone[]): Promise<void> {
    if (tombstones.length === 0) return;
    const existing = await StorageService.getLibraryTombstones();
    const byId = new Map(existing.map((tombstone) => [tombstone.id, tombstone]));

    for (const tombstone of tombstones) {
      const current = byId.get(tombstone.id);
      if (!current || tombstone.deletedAt >= current.deletedAt) {
        byId.set(tombstone.id, tombstone);
      }
    }

    await StorageService.saveLibraryTombstones(Array.from(byId.values()));
  }
}
