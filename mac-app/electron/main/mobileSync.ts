/**
 * MobileSync - Syncs mobile data (transcriptions, sketches, todos) from Supabase.
 *
 * This module handles:
 * - Transcriptions: One-way sync from iOS → Mac clipboard history
 * - Sketches: One-way sync from iOS → Mac clipboard history
 * - Todos: Bidirectional sync with realtime updates
 * - Tier detection: Monitors user subscription status
 *
 * Authentication is handled by AuthManager - this module subscribes to
 * session changes and starts/stops sync accordingly.
 */

import { SupabaseClient, Session, RealtimeChannel } from '@supabase/supabase-js';
import { ClipboardManager } from './clipboardManager';
import { PreferencesManager } from './preferences';
import { AuthManager } from './authManager';
import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

interface TranscriptRow {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  updated_at: string;
}

interface SketchRow {
  id: string;
  user_id: string;
  client_id: string;
  image_path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string | null;
  title: string | null;
  client_created_at_ms: number;
  created_at: string;
  updated_at: string;
}

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

export interface Todo {
  id: string;
  clientId: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// MobileSync
// =============================================================================

export class MobileSync extends EventEmitter {
  private authManager: AuthManager;
  private clipboardManager: ClipboardManager;
  private preferences: PreferencesManager;
  private boundHandleSessionChanged: (session: Session | null) => void;

  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncedAt: number = 0;
  private syncEnabled: boolean = true;

  // Track synced items to avoid duplicates
  private syncedClientIds: Set<string> = new Set();
  private syncedSketchIds: Set<string> = new Set();

  // Local cache of todos
  private todos: Todo[] = [];

  // Realtime subscriptions
  private todoRealtimeChannel: RealtimeChannel | null = null;
  private todoRealtimeConnected: boolean = false;
  private todoReconnectTimer: NodeJS.Timeout | null = null;
  private profileRealtimeChannel: RealtimeChannel | null = null;
  private profileReconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    authManager: AuthManager,
    clipboardManager: ClipboardManager,
    preferences: PreferencesManager
  ) {
    super();
    this.authManager = authManager;
    this.clipboardManager = clipboardManager;
    this.preferences = preferences;

    // Store bound handler reference for proper cleanup in destroy()
    this.boundHandleSessionChanged = this.handleSessionChanged.bind(this);

    // Subscribe to auth state changes
    this.authManager.on('sessionChanged', this.boundHandleSessionChanged);
  }

  /**
   * Initialize MobileSync - starts sync if already authenticated.
   * Call this after construction to handle existing sessions from disk.
   */
  async init(): Promise<void> {
    console.log('[MobileSync] Initializing...');

    // If AuthManager already has a valid session (restored from disk), start sync.
    if (this.isAuthenticated()) {
      console.log('[MobileSync] Session already active, starting sync');
      this.startPeriodicSync();
      this.setupTodoRealtimeSubscription();
      this.setupProfileRealtimeSubscription();
      await this.fetchAndEmitCurrentTier();
    } else {
      console.log('[MobileSync] No active session, waiting for auth');
    }
  }

  /**
   * Handle session state changes from AuthManager.
   */
  private handleSessionChanged(session: Session | null): void {
    if (session) {
      console.log('[MobileSync] Session active, starting sync');
      this.startPeriodicSync();
      this.setupTodoRealtimeSubscription();
      this.setupProfileRealtimeSubscription();
      this.fetchAndEmitCurrentTier();
    } else {
      console.log('[MobileSync] Session cleared, stopping sync');
      this.teardownTodoRealtimeSubscription();
      this.teardownProfileRealtimeSubscription();
      this.stopPeriodicSync();
    }
  }

  // ===========================================================================
  // Getters - Delegate to AuthManager
  // ===========================================================================

  private get supabase(): SupabaseClient | null {
    return this.authManager.getSupabaseClient();
  }

  private get session(): Session | null {
    return this.authManager.getSession();
  }

  /**
   * Check if authenticated (delegates to AuthManager).
   */
  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  /**
   * Get the Supabase client for direct queries.
   */
  getSupabaseClient(): SupabaseClient | null {
    return this.supabase;
  }

  /**
   * Get current session (delegates to AuthManager).
   */
  getSession(): Session | null {
    return this.session;
  }

  // ===========================================================================
  // Sync Enable/Disable
  // ===========================================================================

  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    console.log(`[MobileSync] Sync ${enabled ? 'enabled' : 'disabled'}`);
  }

  getSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  // ===========================================================================
  // Tier Detection
  // ===========================================================================

  private async fetchAndEmitCurrentTier(): Promise<void> {
    const userId = this.session?.user?.id;
    if (!this.supabase || !userId) return;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('tier')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[MobileSync] Failed to fetch tier:', error);
        return;
      }

      if (data?.tier) {
        console.log('[MobileSync] Fetched tier from server:', data.tier);
        this.emit('tierChanged', data.tier);
      }
    } catch (err) {
      console.error('[MobileSync] Error fetching tier:', err);
    }
  }

  // ===========================================================================
  // Periodic Sync
  // ===========================================================================

  private startPeriodicSync(): void {
    if (this.syncInterval) {
      return; // Already running
    }

    // Run immediate sync
    this.syncTranscripts().catch(err => {
      console.error('[MobileSync] Initial transcript sync failed:', err);
    });

    this.syncSketches().catch(err => {
      console.error('[MobileSync] Initial sketch sync failed:', err);
    });

    // Sync every 60 seconds
    this.syncInterval = setInterval(() => {
      if (!this.syncEnabled || !this.session) {
        return;
      }
      this.syncTranscripts().catch(err => {
        console.error('[MobileSync] Periodic sync failed:', err);
      });

      // Only sync todos via polling if realtime is not connected
      if (!this.todoRealtimeConnected) {
        this.syncTodos().catch(err => {
          console.error('[MobileSync] Todo sync failed:', err);
        });
      }

      this.syncSketches().catch(err => {
        console.error('[MobileSync] Sketch sync failed:', err);
      });
    }, 60000);

    console.log('[MobileSync] Periodic sync started');
  }

  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[MobileSync] Periodic sync stopped');
    }
  }

  // ===========================================================================
  // Todo Realtime Subscription
  // ===========================================================================

  private setupTodoRealtimeSubscription(): void {
    if (!this.supabase || !this.session) return;

    this.teardownTodoRealtimeSubscription();

    console.log('[MobileSync] Setting up realtime subscription for todos');

    this.todoRealtimeChannel = this.supabase
      .channel('todos-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'todos',
        },
        (payload) => {
          console.log('[MobileSync] Realtime INSERT todo:', payload.new?.id);
          const row = payload.new as TodoRow;
          const todo: Todo = {
            id: row.id,
            clientId: row.client_id,
            text: row.text,
            completed: row.completed,
            createdAt: row.client_created_at_ms,
            updatedAt: new Date(row.updated_at).getTime(),
          };
          if (!this.todos.some(t => t.id === todo.id)) {
            this.todos = [todo, ...this.todos];
            this.emit('todoAdded', todo);
            this.emit('todosChanged', this.todos);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'todos',
        },
        (payload) => {
          console.log('[MobileSync] Realtime UPDATE todo:', payload.new?.id);
          const row = payload.new as TodoRow;
          const todo: Todo = {
            id: row.id,
            clientId: row.client_id,
            text: row.text,
            completed: row.completed,
            createdAt: row.client_created_at_ms,
            updatedAt: new Date(row.updated_at).getTime(),
          };
          this.todos = this.todos.map(t => t.id === todo.id ? todo : t);
          this.emit('todoUpdated', todo);
          this.emit('todosChanged', this.todos);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'todos',
        },
        (payload) => {
          console.log('[MobileSync] Realtime DELETE todo:', payload.old?.id);
          const deletedId = (payload.old as TodoRow)?.id;
          if (deletedId) {
            this.todos = this.todos.filter(t => t.id !== deletedId);
            this.emit('todoDeleted', deletedId);
            this.emit('todosChanged', this.todos);
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error('[MobileSync] Todo realtime subscription error:', err);
          this.todoRealtimeConnected = false;
        }
        console.log('[MobileSync] Todo realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          this.todoRealtimeConnected = true;
          // Fetch initial todos now that subscription is active
          this.syncTodos().catch(err => {
            console.error('[MobileSync] Initial todo sync failed:', err);
          });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          this.todoRealtimeConnected = false;
          // Try to reconnect after a delay (only if not already scheduled)
          if (this.session && !this.todoReconnectTimer) {
            this.todoReconnectTimer = setTimeout(() => {
              this.todoReconnectTimer = null;
              if (this.session && !this.todoRealtimeConnected) {
                console.log('[MobileSync] Attempting to reconnect todo realtime...');
                this.setupTodoRealtimeSubscription();
              }
            }, 5000);
          }
        }
      });
  }

  private teardownTodoRealtimeSubscription(): void {
    // Clear any pending reconnect timer
    if (this.todoReconnectTimer) {
      clearTimeout(this.todoReconnectTimer);
      this.todoReconnectTimer = null;
    }
    if (this.todoRealtimeChannel) {
      console.log('[MobileSync] Tearing down todo realtime subscription');
      this.supabase?.removeChannel(this.todoRealtimeChannel);
      this.todoRealtimeChannel = null;
    }
    this.todoRealtimeConnected = false;
  }

  // ===========================================================================
  // Profile Tier Realtime Subscription
  // ===========================================================================

  private setupProfileRealtimeSubscription(): void {
    const userId = this.session?.user?.id;
    if (!this.supabase || !userId) return;

    this.teardownProfileRealtimeSubscription();

    console.log('[MobileSync] Setting up realtime subscription for profile tier');

    this.profileRealtimeChannel = this.supabase
      .channel('profile-tier')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const newTier = payload.new?.tier;
          const oldTier = payload.old?.tier;
          if (newTier && newTier !== oldTier) {
            console.log(`[MobileSync] Tier changed via realtime: ${oldTier} -> ${newTier}`);
            this.emit('tierChanged', newTier);
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error('[MobileSync] Profile realtime subscription error:', err);
        }
        if (status === 'SUBSCRIBED') {
          console.log('[MobileSync] Profile realtime subscription active');
        }
      });
  }

  private teardownProfileRealtimeSubscription(): void {
    if (this.profileRealtimeChannel) {
      console.log('[MobileSync] Tearing down profile realtime subscription');
      this.supabase?.removeChannel(this.profileRealtimeChannel);
      this.profileRealtimeChannel = null;
    }
  }

  // ===========================================================================
  // Transcript Sync
  // ===========================================================================

  async syncTranscripts(): Promise<number> {
    if (!this.supabase || !this.session) {
      return 0;
    }

    try {
      let query = this.supabase
        .from('transcripts')
        .select('*')
        .order('client_created_at_ms', { ascending: false });

      if (this.lastSyncedAt > 0) {
        const overlapMs = 60000;
        query = query.gt('client_created_at_ms', this.lastSyncedAt - overlapMs);
      } else {
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
        if (this.syncedClientIds.has(transcript.client_id)) {
          continue;
        }

        const itemId = await this.clipboardManager.storeText(
          transcript.text,
          'transcript',
          undefined,
          undefined,
          'ios',
          transcript.client_created_at_ms
        );

        if (itemId > 0) {
          this.syncedClientIds.add(transcript.client_id);
          syncedCount++;
        }

        if (transcript.client_created_at_ms > latestTimestamp) {
          latestTimestamp = transcript.client_created_at_ms;
        }
      }

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

  async forceSyncAll(): Promise<number> {
    this.lastSyncedAt = 0;
    this.syncedClientIds.clear();
    this.syncedSketchIds.clear();
    const transcriptCount = await this.syncTranscripts();
    const sketchCount = await this.syncSketches();
    return transcriptCount + sketchCount;
  }

  // ===========================================================================
  // Sketch Sync
  // ===========================================================================

  async syncSketches(): Promise<number> {
    if (!this.supabase || !this.session) {
      return 0;
    }

    try {
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      const { data: sketches, error } = await this.supabase
        .from('sketch_items')
        .select('*')
        .gt('client_created_at_ms', sevenDaysAgo)
        .order('client_created_at_ms', { ascending: false });

      if (error) {
        throw error;
      }

      if (!sketches || sketches.length === 0) {
        return 0;
      }

      let syncedCount = 0;

      for (const sketch of sketches as SketchRow[]) {
        if (this.syncedSketchIds.has(sketch.client_id)) {
          continue;
        }

        try {
          const { data: imageData, error: downloadError } = await this.supabase.storage
            .from('sketch-images')
            .download(sketch.image_path);

          if (downloadError || !imageData) {
            console.error(`[MobileSync] Failed to download sketch ${sketch.client_id}:`, downloadError);
            continue;
          }

          const arrayBuffer = await imageData.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);

          const { nativeImage } = await import('electron');
          const image = nativeImage.createFromBuffer(imageBuffer);

          if (image.isEmpty()) {
            console.error(`[MobileSync] Failed to create image from sketch ${sketch.client_id}`);
            continue;
          }

          const itemId = await this.clipboardManager.storeImage(
            image,
            imageBuffer,
            'image',
            undefined,
            undefined,
            'ios'
          );

          if (itemId > 0) {
            if (sketch.title) {
              this.clipboardManager.updateItemContent(itemId, `Sketch: ${sketch.title}`);
            }

            this.syncedSketchIds.add(sketch.client_id);
            syncedCount++;
          }
        } catch (sketchError) {
          console.error(`[MobileSync] Error processing sketch ${sketch.client_id}:`, sketchError);
        }
      }

      if (syncedCount > 0) {
        console.log(`[MobileSync] Synced ${syncedCount} new sketches from iOS`);
      }

      return syncedCount;
    } catch (error) {
      console.error('[MobileSync] Failed to sync sketches:', error);
      throw error;
    }
  }

  // ===========================================================================
  // Todo Operations
  // ===========================================================================

  getTodos(): Todo[] {
    return [...this.todos];
  }

  async syncTodos(): Promise<Todo[]> {
    if (!this.supabase) {
      console.warn('[MobileSync] syncTodos: Supabase not initialized');
      return this.todos;
    }

    if (!this.session) {
      console.warn('[MobileSync] syncTodos: No session');
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

      this.todos.unshift(newTodo);
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Created todo: ${text.substring(0, 30)}...`);
      return newTodo;
    } catch (error) {
      console.error('[MobileSync] Failed to create todo:', error);
      throw error;
    }
  }

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

  async toggleTodo(id: string): Promise<Todo | null> {
    if (!this.supabase || !this.session) {
      console.warn('[MobileSync] Cannot toggle todo - not authenticated');
      return null;
    }

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

      this.todos = this.todos.filter(t => t.id !== id);
      this.emit('todosChanged', this.todos);

      console.log(`[MobileSync] Deleted todo: ${id}`);
      return true;
    } catch (error) {
      console.error('[MobileSync] Failed to delete todo:', error);
      throw error;
    }
  }

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

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.teardownTodoRealtimeSubscription();
    this.teardownProfileRealtimeSubscription();
    this.stopPeriodicSync();
    this.authManager.removeListener('sessionChanged', this.boundHandleSessionChanged);
    this.removeAllListeners();
    console.log('[MobileSync] Destroyed');
  }
}
