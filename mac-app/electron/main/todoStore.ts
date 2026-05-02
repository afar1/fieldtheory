/**
 * TodoStore - Supabase realtime sync for todos.
 *
 * Simple store that:
 * - Subscribes to realtime changes on the todos table (filtered by user_id)
 * - Provides CRUD operations
 * - Maintains a local cache for quick access
 * - Emits 'todosChanged' event when the list changes
 */

import { SupabaseClient, Session, RealtimeChannel } from '@supabase/supabase-js';
import { AuthManager } from './authManager';
import { EventEmitter } from 'events';
import { createLogger } from './logger';

const log = createLogger('Todo');

// =============================================================================
// Types
// =============================================================================

export interface Todo {
  id: string;
  clientId: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

interface TodoRow {
  id: string;
  client_id: string;
  user_id: string;
  text: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// TodoStore Class
// =============================================================================

export class TodoStore extends EventEmitter {
  private authManager: AuthManager;
  private todos: Todo[] = [];
  private channel: RealtimeChannel | null = null;
  private readonly handleSignedIn = (): void => this.subscribe();
  private readonly handleSignedOut = (): void => this.unsubscribe();

  constructor(authManager: AuthManager) {
    super();
    this.authManager = authManager;

    // Subscribe to auth changes.
    this.authManager.on('signedIn', this.handleSignedIn);
    this.authManager.on('signedOut', this.handleSignedOut);

    // Subscribe immediately if already authenticated
    if (this.authManager.isAuthenticated()) {
      this.subscribe();
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private get supabase(): SupabaseClient | null {
    return this.authManager.getSupabaseClient();
  }

  private get session(): Session | null {
    return this.authManager.getSession();
  }

  private getUserId(): string | null {
    return this.session?.user?.id || null;
  }

  private rowToTodo(row: TodoRow): Todo {
    return {
      id: row.id,
      clientId: row.client_id,
      text: row.text,
      completed: row.completed,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  private emitChange(): void {
    this.emit('todosChanged', [...this.todos]);
  }

  // ===========================================================================
  // Realtime Subscription
  // ===========================================================================

  private subscribe(): void {
    const userId = this.getUserId();
    if (!userId || !this.supabase) return;

    log.info('Subscribing to realtime updates');

    this.channel = this.supabase
      .channel(`todos:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'todos', filter: `user_id=eq.${userId}` },
        (payload) => this.handleRealtimeEvent(payload)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          log.info('Realtime subscription active');
          this.syncTodos();
        } else if (status === 'CHANNEL_ERROR') {
          log.error('Realtime subscription error');
        }
      });
  }

  private unsubscribe(): void {
    if (this.channel) {
      log.info('Unsubscribing from realtime updates');
      this.supabase?.removeChannel(this.channel);
      this.channel = null;
    }
    this.todos = [];
    this.emitChange();
  }

  private handleRealtimeEvent(payload: { eventType: string; new?: unknown; old?: unknown }): void {
    const { eventType } = payload;

    if (eventType === 'INSERT') {
      const row = payload.new as TodoRow;
      const todo = this.rowToTodo(row);
      if (!this.todos.find((t) => t.id === todo.id)) {
        this.todos.push(todo);
        this.sortTodos();
        log.debug('Todo inserted:', todo.id);
        this.emitChange();
      }
    } else if (eventType === 'UPDATE') {
      const row = payload.new as TodoRow;
      const todo = this.rowToTodo(row);
      const index = this.todos.findIndex((t) => t.id === todo.id);
      if (index >= 0) {
        this.todos[index] = todo;
        log.debug('Todo updated:', todo.id);
        this.emitChange();
      }
    } else if (eventType === 'DELETE') {
      const row = payload.old as TodoRow;
      const index = this.todos.findIndex((t) => t.id === row.id);
      if (index >= 0) {
        this.todos.splice(index, 1);
        log.debug('Todo deleted:', row.id);
        this.emitChange();
      }
    }
  }

  private sortTodos(): void {
    this.todos.sort((a, b) => a.createdAt - b.createdAt);
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  getTodos(): Todo[] {
    return [...this.todos];
  }

  async syncTodos(): Promise<Todo[]> {
    const userId = this.getUserId();
    if (!userId || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('todos')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        log.error('Sync failed:', error.message);
        return [];
      }

      this.todos = (data as TodoRow[]).map((row) => this.rowToTodo(row));
      log.info('Synced', this.todos.length, 'todos');
      this.emitChange();
      return this.todos;
    } catch (err) {
      log.error('Sync error:', err);
      return [];
    }
  }

  async create(text: string, clientId: string): Promise<Todo | null> {
    const userId = this.getUserId();
    if (!userId || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('todos')
        .insert({
          user_id: userId,
          client_id: clientId,
          text,
          completed: false,
          client_created_at_ms: Date.now(),
        })
        .select()
        .single();

      if (error) {
        log.error('Create failed:', error.message);
        return null;
      }

      return this.rowToTodo(data as TodoRow);
    } catch (err) {
      log.error('Create error:', err);
      return null;
    }
  }

  async update(id: string, updates: Partial<Pick<Todo, 'text' | 'completed'>>): Promise<boolean> {
    if (!this.supabase) return false;

    try {
      const { error } = await this.supabase
        .from('todos')
        .update(updates)
        .eq('id', id);

      if (error) {
        log.error('Update failed:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      log.error('Update error:', err);
      return false;
    }
  }

  async toggle(id: string): Promise<boolean> {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) return false;
    return this.update(id, { completed: !todo.completed });
  }

  async delete(id: string): Promise<boolean> {
    if (!this.supabase) return false;

    try {
      const { error } = await this.supabase.from('todos').delete().eq('id', id);

      if (error) {
        log.error('Delete failed:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      log.error('Delete error:', err);
      return false;
    }
  }

  async deleteBatch(ids: string[]): Promise<boolean> {
    if (!this.supabase || ids.length === 0) return false;

    try {
      const { error } = await this.supabase.from('todos').delete().in('id', ids);

      if (error) {
        log.error('Delete batch failed:', error.message);
        return false;
      }

      log.info('Deleted', ids.length, 'todos');
      return true;
    } catch (err) {
      log.error('Delete batch error:', err);
      return false;
    }
  }

  async completeBatch(ids: string[]): Promise<boolean> {
    if (!this.supabase || ids.length === 0) return false;

    try {
      const { error } = await this.supabase
        .from('todos')
        .update({ completed: true })
        .in('id', ids);

      if (error) {
        log.error('Complete batch failed:', error.message);
        return false;
      }

      log.info('Completed', ids.length, 'todos');
      return true;
    } catch (err) {
      log.error('Complete batch error:', err);
      return false;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.unsubscribe();
    this.authManager.off('signedIn', this.handleSignedIn);
    this.authManager.off('signedOut', this.handleSignedOut);
    this.removeAllListeners();
  }
}
