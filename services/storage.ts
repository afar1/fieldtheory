import AsyncStorage from '@react-native-async-storage/async-storage';
import { Todo, Observation, Settings } from '../types';

// Storage keys
const TODOS_KEY = '@littleai/todos';
const OBSERVATIONS_KEY = '@littleai/observations';
const SETTINGS_KEY = '@littleai/settings';

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
      return data ? JSON.parse(data) : [];
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
      return data ? JSON.parse(data) : [];
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
   */
  static async getSettings(): Promise<Settings> {
    try {
      const data = await AsyncStorage.getItem(SETTINGS_KEY);
      return data ? JSON.parse(data) : { autoStart: false };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return { autoStart: false };
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
}


