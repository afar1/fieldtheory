/**
 * MobileSync - Syncs mobile data (transcriptions, todos) from Supabase.
 * 
 * Transcriptions: Synced to clipboard history with source='ios'.
 * Todos: Synced bidirectionally - changes on Mac push back to Supabase.
 */

import { createClient, SupabaseClient, Session, SupportedStorage } from '@supabase/supabase-js';
import { ClipboardManager } from './clipboardManager';
import { PreferencesManager } from './preferences';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * Simple in-memory storage adapter for Supabase auth in the main process.
 * This is needed for OTP verification to work - the Supabase client needs
 * to persist state between the OTP request and verification steps.
 */
class MemoryStorage implements SupportedStorage {
  private storage: Map<string, string> = new Map();

  async getItem(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.storage.delete(key);
  }
}

/**
 * Row from the Supabase transcripts table.
 */
interface TranscriptRow {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  updated_at: string;
}

/**
 * Row from the Supabase todos table.
 */
interface TodoRow {
  id: string;
  user_id: string;
  text: string;
  completed: boolean;
  client_id: string;
  client_created_at_ms: number;
  created_at: string;
  updated_at: string;
}

/**
 * Local todo representation for the Mac app.
 */
export interface Todo {
  id: string;           // Supabase UUID
  clientId: string;     // Client-generated ID for deduplication
  text: string;
  completed: boolean;
  createdAt: number;    // client_created_at_ms
  updatedAt: number;    // Parsed from updated_at
}

/**
 * Preferences for mobile sync feature.
 */
interface MobileSyncConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  lastSyncedAt?: number;
  syncEnabled?: boolean;
}

/**
 * Manages syncing mobile data to/from Supabase.
 * - Transcriptions: One-way sync (iOS → Mac clipboard history)
 * - Todos: Bidirectional sync (iOS ↔ Mac)
 */
export class MobileSync extends EventEmitter {
  private clipboardManager: ClipboardManager;
  private preferences: PreferencesManager;
  private supabase: SupabaseClient | null = null;
  private session: Session | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncedAt: number = 0;
  private syncEnabled: boolean = true;

  // Track which client_ids we've already synced to avoid duplicates.
  private syncedClientIds: Set<string> = new Set();

  // Local cache of todos for the UI.
  private todos: Todo[] = [];

  constructor(clipboardManager: ClipboardManager, preferences: PreferencesManager) {
    super();
    this.clipboardManager = clipboardManager;
    this.preferences = preferences;
  }

  /**
   * Initialize the sync module with Supabase credentials.
   * Call this after preferences are loaded.
   */
  async init(supabaseUrl?: string, supabaseAnonKey?: string): Promise<void> {
    // Use provided credentials or fall back to environment variables.
    const url = supabaseUrl || process.env.VITE_SUPABASE_URL;
    const anonKey = supabaseAnonKey || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      console.log('[MobileSync] No Supabase credentials available, sync disabled');
      return;
    }

    // Use in-memory storage for auth state - required for OTP verification to work.
    // The Supabase client needs storage to track state between OTP request and verify.
    // Explicit WebSocket transport fixes Realtime timeouts in Node.js < v22 / Electron.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = createClient(url, anonKey, {
      auth: {
        storage: new MemoryStorage(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        transport: WebSocket as any,
      },
    });

    console.log('[MobileSync] Initialized with Supabase client');
  }

  /**
   * Set the authenticated session from the renderer process.
   * This allows the main process to make authenticated Supabase calls.
   */
  async setSession(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.supabase) {
      console.warn('[MobileSync] Cannot set session - Supabase not initialized');
      return;
    }

    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('[MobileSync] Failed to set session:', error);
      return;
    }

    this.session = data.session;
    console.log('[MobileSync] Session set for user:', this.session?.user?.email);

    // Start periodic sync now that we're authenticated.
    this.startPeriodicSync();
  }

  /**
   * Clear the session (e.g., when user signs out).
   */
  clearSession(): void {
    this.session = null;
    this.stopPeriodicSync();
    console.log('[MobileSync] Session cleared');
  }

  /**
   * Enable or disable sync.
   */
  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    if (enabled && this.session) {
      this.startPeriodicSync();
    } else if (!enabled) {
      this.stopPeriodicSync();
    }
    console.log(`[MobileSync] Sync ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if sync is currently enabled.
   */
  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  // ===========================================================================
  // Password Authentication - Simple email/password sign-in.
  // ===========================================================================

  /**
   * Sign up with email and password.
   * Creates a new account. User must verify email before they can sign in.
   */
  async signUp(email: string, password: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[MobileSync] Signing up:', email);

    const { error } = await this.supabase.auth.signUp({ email, password });

    if (error) {
      console.error('[MobileSync] Sign up failed:', error);
      return { error: error.message };
    }

    console.log('[MobileSync] Sign up successful, verification email sent to:', email);
    return { error: null };
  }

  /**
   * Sign in with email and password.
   */
  async signInWithPassword(email: string, password: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[MobileSync] Signing in with password for:', email);

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('[MobileSync] Sign in failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        console.log('[MobileSync] Signed in, session established for:', data.session.user?.email);
        this.startPeriodicSync();
        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Sign in exception:', message);
      return { error: message, session: null };
    }
  }

  /**
   * Send a password reset email.
   * User clicks the link in the email, which opens a web page to set their password.
   * After setting password, user returns to app and signs in.
   */
  async resetPasswordForEmail(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[MobileSync] Sending password reset email to:', email);

    try {
      // Redirect to our browser-based password reset page.
      // This page handles the token and lets users set their password in a regular browser.
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'http://localhost:5173/reset-password.html',
      });

      if (error) {
        console.error('[MobileSync] Password reset email failed:', error);
        return { error: error.message };
      }

      console.log('[MobileSync] Password reset email sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Password reset exception:', message);
      return { error: message };
    }
  }

  /**
   * Set a new password (used after clicking reset link).
   * The session must already be established from the recovery token.
   */
  async updatePassword(newPassword: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    if (!this.session) {
      return { error: 'No active session - click the reset link in your email first' };
    }

    console.log('[MobileSync] Updating password...');

    try {
      const { error } = await this.supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        console.error('[MobileSync] Password update failed:', error);
        return { error: error.message };
      }

      console.log('[MobileSync] Password updated successfully');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Password update exception:', message);
      return { error: message };
    }
  }

  /**
   * Set session from a recovery token (from password reset email link).
   * The URL contains #access_token=...&refresh_token=...
   */
  async setSessionFromUrl(accessToken: string, refreshToken: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[MobileSync] Setting session from recovery token...');

    try {
      const { data, error } = await this.supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        console.error('[MobileSync] Failed to set session from token:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        console.log('[MobileSync] Session established from recovery token for:', data.session.user?.email);
        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Set session exception:', message);
      return { error: message, session: null };
    }
  }

  /**
   * Sign out the current user.
   */
  async signOut(): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    try {
      const { error } = await this.supabase.auth.signOut();
      
      if (error) {
        console.error('[MobileSync] Sign out failed:', error);
        return { error: error.message };
      }

      this.clearSession();
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Sign out exception:', message);
      return { error: message };
    }
  }

  /**
   * Get the current session (if any).
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Start periodic sync (every 30 seconds).
   * Also runs an immediate sync.
   */
  private startPeriodicSync(): void {
    if (this.syncInterval) {
      return; // Already running.
    }

    // Run immediate sync.
    this.syncTranscripts().catch(err => {
      console.error('[MobileSync] Initial sync failed:', err);
    });

    // Sync every 60 seconds. Realtime handles instant updates for todos; this is the fallback.
    this.syncInterval = setInterval(() => {
      if (!this.syncEnabled || !this.session) {
        return;
      }
      this.syncTranscripts().catch(err => {
        console.error('[MobileSync] Periodic sync failed:', err);
      });
      
      // Sync todos periodically as fallback (Realtime handles instant updates when connected).
      this.syncTodos().catch(err => {
        console.error('[MobileSync] Todo sync failed:', err);
      });
    }, 60000);

    console.log('[MobileSync] Periodic sync started');
  }

  /**
   * Stop periodic sync.
   */
  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[MobileSync] Periodic sync stopped');
    }
  }

  /**
   * Fetch new transcripts from Supabase and add to clipboard history.
   * Only fetches transcripts newer than the last sync.
   */
  async syncTranscripts(): Promise<number> {
    if (!this.supabase || !this.session) {
      return 0;
    }

    try {
      // Fetch transcripts updated since last sync.
      // We use updated_at to catch edits, but client_created_at_ms for the actual timestamp.
      let query = this.supabase
        .from('transcripts')
        .select('*')
        .order('client_created_at_ms', { ascending: false });

      // If we've synced before, only fetch newer items.
      if (this.lastSyncedAt > 0) {
        // Use a small overlap window (1 minute) to catch any edge cases.
        const overlapMs = 60000;
        query = query.gt('client_created_at_ms', this.lastSyncedAt - overlapMs);
      } else {
        // First sync - limit to last 7 days to avoid importing huge backlog.
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        query = query.gt('client_created_at_ms', sevenDaysAgo);
      }

      const { data: transcripts, error } = await query;

      if (error) {
        throw error;
      }

      if (!transcripts || transcripts.length === 0) {
        return 0;
      }

      let syncedCount = 0;
      let latestTimestamp = this.lastSyncedAt;

      for (const transcript of transcripts as TranscriptRow[]) {
        // Skip if we've already synced this client_id.
        if (this.syncedClientIds.has(transcript.client_id)) {
          continue;
        }

        // Insert into clipboard history with source='ios'.
        // Use createdAtOverride to preserve the original recording timestamp.
        const itemId = await this.clipboardManager.storeText(
          transcript.text,
          'transcript',
          undefined, // No source app for iOS items.
          undefined, // No stack ID.
          'ios',
          transcript.client_created_at_ms
        );

        if (itemId > 0) {
          this.syncedClientIds.add(transcript.client_id);
          syncedCount++;
        }

        // Track latest timestamp for next sync.
        if (transcript.client_created_at_ms > latestTimestamp) {
          latestTimestamp = transcript.client_created_at_ms;
        }
      }

      // Update last synced timestamp.
      if (latestTimestamp > this.lastSyncedAt) {
        this.lastSyncedAt = latestTimestamp;
      }

      if (syncedCount > 0) {
        console.log(`[MobileSync] Synced ${syncedCount} new transcripts from iOS`);
      }

      return syncedCount;
    } catch (error) {
      console.error('[MobileSync] Failed to sync transcripts:', error);
      throw error;
    }
  }

  /**
   * Force a full sync, ignoring the last synced timestamp.
   * Useful for debugging or when the user wants to re-sync.
   */
  async forceSyncAll(): Promise<number> {
    this.lastSyncedAt = 0;
    this.syncedClientIds.clear();
    return this.syncTranscripts();
  }

  // ==========================================================================
  // Todo Sync - Bidirectional sync with Supabase
  // ==========================================================================

  /**
   * Get all todos from local cache.
   */
  getTodos(): Todo[] {
    return [...this.todos];
  }

  /**
   * Check if authenticated (has valid session).
   */
  isAuthenticated(): boolean {
    return !!(this.supabase && this.session);
  }

  /**
   * Fetch todos from Supabase and update local cache.
   * Emits 'todosChanged' event when todos are updated.
   */
  async syncTodos(): Promise<Todo[]> {
    if (!this.supabase) {
      console.warn('[MobileSync] syncTodos: Supabase not initialized');
      return this.todos;
    }
    
    if (!this.session) {
      console.warn('[MobileSync] syncTodos: No session - user needs to log in via Settings → Mobile Sync');
      return this.todos;
    }

    try {
      console.log('[MobileSync] Fetching todos from Supabase...');
      const { data: rows, error } = await this.supabase
        .from('todos')
        .select('*')
        .order('client_created_at_ms', { ascending: false });

      if (error) {
        console.error('[MobileSync] Supabase query error:', error);
        throw error;
      }

      if (!rows) {
        console.log('[MobileSync] No todos returned from Supabase');
        return this.todos;
      }

      // Convert rows to local Todo format.
      this.todos = (rows as TodoRow[]).map(row => ({
        id: row.id,
        clientId: row.client_id,
        text: row.text,
        completed: row.completed,
        createdAt: row.client_created_at_ms,
        updatedAt: new Date(row.updated_at).getTime(),
      }));

      console.log(`[MobileSync] Synced ${this.todos.length} todos from Supabase`);
      this.emit('todosChanged', this.todos);
      return this.todos;
    } catch (error) {
      console.error('[MobileSync] Failed to sync todos:', error);
      throw error;
    }
  }

  /**
   * Create a new todo and sync to Supabase.
   */
  async createTodo(text: string): Promise<Todo | null> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot create todo - not authenticated');
      return null;
    }

    const clientId = crypto.randomUUID();
    const now = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('todos')
        .insert({
          user_id: this.session.user.id,
          text,
          completed: false,
          client_id: clientId,
          client_created_at_ms: now,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      const newTodo: Todo = {
        id: data.id,
        clientId: data.client_id,
        text: data.text,
        completed: data.completed,
        createdAt: data.client_created_at_ms,
        updatedAt: new Date(data.updated_at).getTime(),
      };

      // Add to local cache at the beginning (newest first).
      this.todos.unshift(newTodo);
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Created todo: ${text.substring(0, 30)}...`);
      return newTodo;
    } catch (error) {
      console.error('[MobileSync] Failed to create todo:', error);
      throw error;
    }
  }

  /**
   * Update a todo's text and sync to Supabase.
   */
  async updateTodo(id: string, text: string): Promise<Todo | null> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot update todo - not authenticated');
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('todos')
        .update({ text })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Update local cache.
      const index = this.todos.findIndex(t => t.id === id);
      if (index !== -1) {
        this.todos[index] = {
          ...this.todos[index],
          text: data.text,
          updatedAt: new Date(data.updated_at).getTime(),
        };
        this.emit('todosChanged', this.todos);
      }

      console.log(`[MobileSync] Updated todo: ${id}`);
      return this.todos[index] || null;
    } catch (error) {
      console.error('[MobileSync] Failed to update todo:', error);
      throw error;
    }
  }

  /**
   * Toggle a todo's completed status and sync to Supabase.
   */
  async toggleTodo(id: string): Promise<Todo | null> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot toggle todo - not authenticated');
      return null;
    }

    // Find current state.
    const todo = this.todos.find(t => t.id === id);
    if (!todo) {
      console.warn(`[MobileSync] Todo not found: ${id}`);
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('todos')
        .update({ completed: !todo.completed })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Update local cache.
      const index = this.todos.findIndex(t => t.id === id);
      if (index !== -1) {
        this.todos[index] = {
          ...this.todos[index],
          completed: data.completed,
          updatedAt: new Date(data.updated_at).getTime(),
        };
        this.emit('todosChanged', this.todos);
      }

      console.log(`[MobileSync] Toggled todo ${id} to ${data.completed ? 'complete' : 'incomplete'}`);
      return this.todos[index] || null;
    } catch (error) {
      console.error('[MobileSync] Failed to toggle todo:', error);
      throw error;
    }
  }

  /**
   * Delete a todo and sync to Supabase.
   */
  async deleteTodo(id: string): Promise<boolean> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot delete todo - not authenticated');
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('todos')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      // Remove from local cache.
      this.todos = this.todos.filter(t => t.id !== id);
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Deleted todo: ${id}`);
      return true;
    } catch (error) {
      console.error('[MobileSync] Failed to delete todo:', error);
      throw error;
    }
  }

  /**
   * Delete multiple todos at once.
   */
  async deleteTodos(ids: string[]): Promise<boolean> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot delete todos - not authenticated');
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('todos')
        .delete()
        .in('id', ids);

      if (error) {
        throw error;
      }

      // Remove from local cache.
      const idSet = new Set(ids);
      this.todos = this.todos.filter(t => !idSet.has(t.id));
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Deleted ${ids.length} todos`);
      return true;
    } catch (error) {
      console.error('[MobileSync] Failed to delete todos:', error);
      throw error;
    }
  }

  /**
   * Mark multiple todos as complete.
   */
  async completeTodos(ids: string[]): Promise<boolean> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot complete todos - not authenticated');
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('todos')
        .update({ completed: true })
        .in('id', ids);

      if (error) {
        throw error;
      }

      // Update local cache.
      const idSet = new Set(ids);
      this.todos = this.todos.map(t => 
        idSet.has(t.id) ? { ...t, completed: true, updatedAt: Date.now() } : t
      );
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Marked ${ids.length} todos as complete`);
      return true;
    } catch (error) {
      console.error('[MobileSync] Failed to complete todos:', error);
      throw error;
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.stopPeriodicSync();
    this.session = null;
    this.removeAllListeners();
    console.log('[MobileSync] Destroyed');
  }
}
