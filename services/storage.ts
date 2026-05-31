import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Todo,
  Observation,
  Settings,
  TranscriptEntry,
  TranscriptSegment,
  LibraryDocument,
  LibraryTombstone,
  LibraryViewState,
  SyncTombstone,
} from '../types';

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

const normalizeLibraryViewState = (raw: Partial<LibraryViewState> | null | undefined): LibraryViewState => ({
  selectedDocumentId: typeof raw?.selectedDocumentId === 'string' ? raw.selectedDocumentId : null,
  recentDocumentIds: Array.isArray(raw?.recentDocumentIds)
    ? raw.recentDocumentIds.filter((id): id is string => typeof id === 'string')
    : [],
  readerScrollOffsets: raw?.readerScrollOffsets && typeof raw.readerScrollOffsets === 'object'
    ? Object.fromEntries(
      Object.entries(raw.readerScrollOffsets)
        .filter((entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0,
        ),
    )
    : {},
  updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : Date.now(),
});

const normalizeSyncTombstone = (raw: SyncTombstone): SyncTombstone => ({
  ...raw,
  deletedAt: raw.deletedAt ?? Date.now(),
});

// Storage keys
const TODOS_KEY = '@littleai/todos';
const OBSERVATIONS_KEY = '@littleai/observations';
const SETTINGS_KEY = '@littleai/settings';
const TRANSCRIPTS_KEY = '@littleai/transcripts';
const LIBRARY_DOCUMENTS_KEY = '@littleai/library-documents';
const LIBRARY_TOMBSTONES_KEY = '@littleai/library-tombstones';
const LIBRARY_VIEW_STATE_KEY = '@littleai/library-view-state';
const SYNC_TOMBSTONES_KEY = '@littleai/sync-tombstones';
const LOCAL_SCOPE_ID = 'local';
const SCOPED_DATA_KEYS = [
  TODOS_KEY,
  OBSERVATIONS_KEY,
  SETTINGS_KEY,
  TRANSCRIPTS_KEY,
  LIBRARY_DOCUMENTS_KEY,
  LIBRARY_TOMBSTONES_KEY,
  LIBRARY_VIEW_STATE_KEY,
  SYNC_TOMBSTONES_KEY,
];

/**
 * Storage service for persisting todos, observations, and settings.
 * Uses AsyncStorage for local persistence.
 */
export class StorageService {
  private static userScopeId: string | null = null;

  static setUserScope(userId: string | null): void {
    StorageService.userScopeId = userId ?? LOCAL_SCOPE_ID;
  }

  private static scopedKey(baseKey: string): string {
    return StorageService.userScopeId ? `${baseKey}:${StorageService.userScopeId}` : baseKey;
  }

  private static scopedKeyForUser(baseKey: string, userId: string): string {
    return `${baseKey}:${userId}`;
  }

  static async migrateLegacyDataToUserScope(userId: string): Promise<void> {
    const backupStamp = Date.now();

    for (const baseKey of SCOPED_DATA_KEYS) {
      const legacyValue = await AsyncStorage.getItem(baseKey);
      if (!legacyValue) continue;

      const scopedKey = StorageService.scopedKeyForUser(baseKey, userId);
      const scopedValue = await AsyncStorage.getItem(scopedKey);
      const backupKey = `${baseKey}:legacy-backup:${userId}:${backupStamp}`;

      await AsyncStorage.setItem(backupKey, legacyValue);
      if (!scopedValue) {
        await AsyncStorage.setItem(scopedKey, legacyValue);
      }
      await AsyncStorage.removeItem(baseKey);
    }
  }

  static async migrateLegacyDataToLocalScope(): Promise<void> {
    const backupStamp = Date.now();

    for (const baseKey of SCOPED_DATA_KEYS) {
      const legacyValue = await AsyncStorage.getItem(baseKey);
      if (!legacyValue) continue;

      const localKey = StorageService.scopedKeyForUser(baseKey, LOCAL_SCOPE_ID);
      const localValue = await AsyncStorage.getItem(localKey);
      const backupKey = `${baseKey}:legacy-local-backup:${backupStamp}`;

      await AsyncStorage.setItem(backupKey, legacyValue);
      if (!localValue) {
        await AsyncStorage.setItem(localKey, legacyValue);
      }
      await AsyncStorage.removeItem(baseKey);
    }
  }

  /**
   * Load all todos from storage.
   */
  static async getTodos(): Promise<Todo[]> {
    try {
      const data = await AsyncStorage.getItem(StorageService.scopedKey(TODOS_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(TODOS_KEY), JSON.stringify(todos));
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
      const data = await AsyncStorage.getItem(StorageService.scopedKey(OBSERVATIONS_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(OBSERVATIONS_KEY), JSON.stringify(observations));
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
      autoSeparate: false,
    };
    
    try {
      const data = await AsyncStorage.getItem(StorageService.scopedKey(SETTINGS_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(SETTINGS_KEY), JSON.stringify(settings));
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
      const data = await AsyncStorage.getItem(StorageService.scopedKey(TRANSCRIPTS_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(TRANSCRIPTS_KEY), JSON.stringify(transcripts));
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
      const data = await AsyncStorage.getItem(StorageService.scopedKey(LIBRARY_DOCUMENTS_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(LIBRARY_DOCUMENTS_KEY), JSON.stringify(documents));
    } catch (error) {
      console.error('Failed to save library documents:', error);
      throw error;
    }
  }

  /**
   * Load lightweight Library UI continuity state.
   */
  static async getLibraryViewState(): Promise<LibraryViewState | null> {
    try {
      const data = await AsyncStorage.getItem(StorageService.scopedKey(LIBRARY_VIEW_STATE_KEY));
      return data ? normalizeLibraryViewState(JSON.parse(data)) : null;
    } catch (error) {
      console.error('Failed to load library view state:', error);
      return null;
    }
  }

  /**
   * Save lightweight Library UI continuity state.
   */
  static async saveLibraryViewState(state: LibraryViewState): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageService.scopedKey(LIBRARY_VIEW_STATE_KEY), JSON.stringify(normalizeLibraryViewState(state)));
    } catch (error) {
      console.error('Failed to save library view state:', error);
      throw error;
    }
  }

  /**
   * Load pending Library tombstones that still need to be synced.
   */
  static async getLibraryTombstones(): Promise<LibraryTombstone[]> {
    try {
      const data = await AsyncStorage.getItem(StorageService.scopedKey(LIBRARY_TOMBSTONES_KEY));
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
      await AsyncStorage.setItem(StorageService.scopedKey(LIBRARY_TOMBSTONES_KEY), JSON.stringify(tombstones));
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

  /**
   * Load pending row tombstones that still need to be synced.
   */
  static async getSyncTombstones(): Promise<SyncTombstone[]> {
    try {
      const data = await AsyncStorage.getItem(StorageService.scopedKey(SYNC_TOMBSTONES_KEY));
      return data ? JSON.parse(data).map(normalizeSyncTombstone) : [];
    } catch (error) {
      console.error('Failed to load sync tombstones:', error);
      return [];
    }
  }

  /**
   * Save pending row tombstones.
   */
  static async saveSyncTombstones(tombstones: SyncTombstone[]): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageService.scopedKey(SYNC_TOMBSTONES_KEY), JSON.stringify(tombstones));
    } catch (error) {
      console.error('Failed to save sync tombstones:', error);
      throw error;
    }
  }

  /**
   * Add pending row tombstones, keeping the newest delete per collection/id.
   */
  static async addSyncTombstones(tombstones: SyncTombstone[]): Promise<void> {
    if (tombstones.length === 0) return;
    const existing = await StorageService.getSyncTombstones();
    const byKey = new Map(existing.map((tombstone) => [`${tombstone.collection}:${tombstone.id}`, tombstone]));

    for (const tombstone of tombstones) {
      const key = `${tombstone.collection}:${tombstone.id}`;
      const current = byKey.get(key);
      if (!current || tombstone.deletedAt >= current.deletedAt) {
        byKey.set(key, tombstone);
      }
    }

    await StorageService.saveSyncTombstones(Array.from(byKey.values()));
  }
}
