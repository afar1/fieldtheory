/**
 * MobileSync - Syncs mobile data (transcriptions, todos) from Supabase.
 * 
 * Transcriptions: Synced to clipboard history with source='ios'.
 * Todos: Synced bidirectionally - changes on Mac push back to Supabase.
 */

import { createClient, SupabaseClient, Session, SupportedStorage, RealtimeChannel } from '@supabase/supabase-js';
import { ClipboardManager } from './clipboardManager';
import { PreferencesManager } from './preferences';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * File-based storage adapter for Supabase auth in the main process.
 * Persists session to disk so it survives app updates. This fixes the issue
 * where users had to re-login after every app update because localStorage
 * is tied to the Chromium partition which can change between versions.
 */
class FileStorage implements SupportedStorage {
  private storage: Map<string, string> = new Map();
  private filePath: string;
  private initialized: boolean = false;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'supabase-session.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.storage = new Map(Object.entries(parsed));
        console.log('[FileStorage] Loaded session from disk');
      }
    } catch (err) {
      console.warn('[FileStorage] Failed to load session from disk:', err);
    }
    this.initialized = true;
  }

  private saveToDisk(): void {
    try {
      const obj: Record<string, string> = {};
      this.storage.forEach((value, key) => {
        obj[key] = value;
      });
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.warn('[FileStorage] Failed to save session to disk:', err);
    }
  }

  async getItem(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
    this.saveToDisk();
  }

  async removeItem(key: string): Promise<void> {
    this.storage.delete(key);
    this.saveToDisk();
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
 * Row from the Supabase sketch_items table.
 */
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
  
  // Track which sketch client_ids we've already synced.
  private syncedSketchIds: Set<string> = new Set();

  // Track last failed token to avoid log spam when renderer retries with same stale token.
  private lastFailedToken: string | null = null;

  // Local cache of todos for the UI.
  private todos: Todo[] = [];

  // Realtime subscription for todos.
  private todoRealtimeChannel: RealtimeChannel | null = null;
  private todoRealtimeConnected: boolean = false;

  // Realtime subscription for profile tier changes (subscription status).
  private profileRealtimeChannel: RealtimeChannel | null = null;

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

    // Use file-based storage for auth state so sessions persist across app updates.
    // This fixes the issue where users had to re-login after every update because
    // localStorage is tied to the Chromium partition which can change between versions.
    // Explicit WebSocket transport fixes Realtime timeouts in Node.js < v22 / Electron.
    const userDataPath = app.getPath('userData');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = createClient(url, anonKey, {
      auth: {
        storage: new FileStorage(userDataPath),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        transport: WebSocket as any,
      },
    });

    console.log('[MobileSync] Initialized with Supabase client, session storage:', userDataPath);
    
    // Try to restore session from file storage. Supabase should have loaded it
    // automatically, but we need to retrieve it and set our local state.
    await this.restoreSessionFromStorage();
  }

  /**
   * Restore session from file storage on startup.
   * This enables auto-login after app updates.
   */
  private async restoreSessionFromStorage(): Promise<void> {
    if (!this.supabase) return;
    
    try {
      const { data, error } = await this.supabase.auth.getSession();
      
      if (error) {
        console.log('[MobileSync] No stored session to restore:', error.message);
        return;
      }
      
      if (data.session) {
        this.session = data.session;
        console.log('[MobileSync] Restored session for user:', data.session.user?.email);
        
        // Start periodic sync now that we're authenticated.
        this.startPeriodicSync();
        this.setupTodoRealtimeSubscription();
        this.setupProfileRealtimeSubscription();
        this.fetchAndEmitCurrentTier();
      } else {
        console.log('[MobileSync] No session found in storage');
      }
    } catch (err) {
      console.warn('[MobileSync] Failed to restore session:', err);
    }
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

    // Skip if we already failed with this exact token (prevents log spam from renderer retries).
    if (this.lastFailedToken === accessToken) {
      return;
    }

    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Token expired or invalid - clear session, user will need to sign in again.
    // This is normal when app hasn't been used for a while.
    if (error) {
      this.lastFailedToken = accessToken;
      console.log('[MobileSync] Session restore failed (tokens expired), user needs to sign in');
      this.clearSession();
      return;
    }

    // Success - clear the failed token tracker.
    this.lastFailedToken = null;
    this.session = data.session;
    console.log('[MobileSync] Session set for user:', this.session?.user?.email);

    // Start periodic sync now that we're authenticated.
    this.startPeriodicSync();
    
    // Setup realtime subscription for instant todo updates.
    this.setupTodoRealtimeSubscription();

    // Setup realtime subscription for profile tier changes (subscription status).
    this.setupProfileRealtimeSubscription();
    
    // Fetch current tier from database to sync with any changes made while app was closed.
    this.fetchAndEmitCurrentTier();
  }
  
  /**
   * Fetch the user's current tier from the database and emit tierChanged.
   * This syncs the local cache with the server after the app restarts.
   */
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

  /**
   * Clear the session (e.g., when user signs out).
   */
  clearSession(): void {
    this.teardownTodoRealtimeSubscription();
    this.teardownProfileRealtimeSubscription();
    this.session = null;
    this.stopPeriodicSync();
    console.log('[MobileSync] Session cleared');
  }

  /**
   * Get the Supabase client for direct queries (e.g., refreshing tier).
   */
  getSupabaseClient(): SupabaseClient | null {
    return this.supabase;
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
        console.log('[MobileSync] Signed in, session established for:', data.session.user?.email);
        
        // Call setSession to trigger the monkey-patched version in index.ts
        // which forwards the session to SharedClipboardSync and SocialSync.
        // This must be called BEFORE setting this.session so the early-return
        // check in the patched version doesn't skip forwarding.
        await this.setSession(data.session.access_token, data.session.refresh_token);
        
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
   * Request OTP code via email. Sends a 6-digit code to the user's email.
   */
  async requestOtp(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[MobileSync] Requesting OTP for:', email);

    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) {
        console.error('[MobileSync] OTP request failed:', error);
        return { error: error.message };
      }

      console.log('[MobileSync] OTP sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] OTP request exception:', message);
      return { error: message };
    }
  }

  /**
   * Verify OTP code and establish session.
   */
  async verifyOtp(email: string, token: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[MobileSync] Verifying OTP for:', email);

    try {
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        console.error('[MobileSync] OTP verification failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        console.log('[MobileSync] OTP verified, session established for:', data.session.user?.email);
        
        // Forward session to sync services.
        await this.setSession(data.session.access_token, data.session.refresh_token);
        
        this.startPeriodicSync();
        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] OTP verification exception:', message);
      return { error: message, session: null };
    }
  }

  /**
   * Load password reset redirect URL from environment or .env.local file.
   * Falls back to localhost for development.
   */
  private getPasswordResetUrl(): string | null {
    // First check process.env (set at runtime or by Vite)
    if (process.env.VITE_PASSWORD_RESET_URL) {
      return process.env.VITE_PASSWORD_RESET_URL;
    }

    // Try to load from .env.local file (same approach as Supabase credentials)
    const envPaths: string[] = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
      path.join(process.cwd(), 'mac-app/.env.local'),
    ];

    // Add app paths if Electron app is available
    try {
      const { app } = require('electron');
      if (app?.isReady()) {
        envPaths.push(
          path.join(app.getAppPath(), '.env.local'),
          path.join(app.getAppPath(), '../.env.local')
        );
      }
    } catch (err) {
      // App not available yet, skip app paths
    }

    for (const envPath of envPaths) {
      try {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          const lines = content.split('\n');
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              const [key, ...valueParts] = trimmed.split('=');
              if (key?.trim() === 'VITE_PASSWORD_RESET_URL' && valueParts.length > 0) {
                const url = valueParts.join('=').trim();
                console.log('[MobileSync] Loaded password reset URL from:', envPath);
                return url;
              }
            }
          }
        }
      } catch (err) {
        // Ignore errors, try next path
      }
    }

    // Fall back to localhost for development.
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      return 'http://localhost:5173/reset-password.html';
    }

    // Production fallback - GitHub Pages URL.
    // This URL should be configured in Supabase dashboard under Auth > URL Configuration > Redirect URLs.
    return 'https://afar1.github.io/field-theory/reset-password.html';
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

    // Get redirect URL from environment variable or .env.local file.
    // In production, this should be set to a publicly accessible URL where reset-password.html is hosted.
    const redirectUrl = this.getPasswordResetUrl();

    if (!redirectUrl) {
      console.error('[MobileSync] Password reset URL not configured. Set VITE_PASSWORD_RESET_URL in .env.local or environment variable.');
      return { error: 'Password reset is not configured. Please set VITE_PASSWORD_RESET_URL to a publicly accessible URL where reset-password.html is hosted.' };
    }

    console.log('[MobileSync] Sending password reset email to:', email);
    console.log('[MobileSync] Using redirect URL:', redirectUrl);

    try {
      // Redirect to our browser-based password reset page.
      // This page handles the token and lets users set their password in a regular browser.
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('[MobileSync] Password reset email failed:', error);
        
        // Parse rate limiting error to show user-friendly message.
        // Supabase returns: "For security purposes, you can only request this after X seconds."
        const rateLimitMatch = error.message.match(/after (\d+) seconds?/i);
        if (rateLimitMatch) {
          const seconds = rateLimitMatch[1];
          return { error: `Please wait ${seconds} seconds before requesting another password reset email.` };
        }
        
        return { error: error.message };
      }

      console.log('[MobileSync] Password reset email sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[MobileSync] Password reset exception:', message);
      
      // Also check for rate limiting in exception message.
      const rateLimitMatch = message.match(/after (\d+) seconds?/i);
      if (rateLimitMatch) {
        const seconds = rateLimitMatch[1];
        return { error: `Please wait ${seconds} seconds before requesting another password reset email.` };
      }
      
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
      // Use setSession which handles everything: sets session via Supabase,
      // stores it locally, and triggers the monkey-patched version in index.ts
      // that forwards to SharedClipboardSync and SocialSync.
      await this.setSession(accessToken, refreshToken);
      
      const session = this.getSession();
      if (session) {
        console.log('[MobileSync] Session established from recovery token for:', session.user?.email);
        return { error: null, session };
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
      console.error('[MobileSync] Initial transcript sync failed:', err);
    });
    
    // Also sync sketches immediately.
    this.syncSketches().catch(err => {
      console.error('[MobileSync] Initial sketch sync failed:', err);
    });

    // Sync every 60 seconds. Realtime handles instant updates for todos; polling is fallback only.
    this.syncInterval = setInterval(() => {
      if (!this.syncEnabled || !this.session) {
        return;
      }
      this.syncTranscripts().catch(err => {
        console.error('[MobileSync] Periodic sync failed:', err);
      });
      
      // Only sync todos via polling if realtime is not connected.
      if (!this.todoRealtimeConnected) {
        this.syncTodos().catch(err => {
          console.error('[MobileSync] Todo sync failed:', err);
        });
      }
      
      // Sync sketches from iOS.
      this.syncSketches().catch(err => {
        console.error('[MobileSync] Sketch sync failed:', err);
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

  // ===========================================================================
  // Todo Realtime Subscription
  // ===========================================================================

  /**
   * Subscribe to realtime changes on the todos table.
   * This enables instant updates when todos are added/updated/deleted from any device.
   */
  private setupTodoRealtimeSubscription(): void {
    if (!this.supabase || !this.session) return;

    // Teardown existing subscription first.
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
          // Add to local cache if not already present.
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
          // Update in local cache.
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
          const oldRow = payload.old as { id?: string };
          if (oldRow?.id) {
            // Remove from local cache.
            this.todos = this.todos.filter(t => t.id !== oldRow.id);
            this.emit('todoDeleted', oldRow.id);
            this.emit('todosChanged', this.todos);
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[MobileSync] Todo realtime subscription status:', status);
        if (err) {
          console.error('[MobileSync] Todo realtime subscription error:', err);
        }

        // Handle different states.
        if (status === 'TIMED_OUT') {
          console.log('[MobileSync] Todo realtime timed out, retrying in 3 seconds...');
          setTimeout(() => {
            if (this.isAuthenticated()) {
              this.setupTodoRealtimeSubscription();
            }
          }, 3000);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[MobileSync] Todo realtime channel error, retrying in 5 seconds...');
          setTimeout(() => {
            if (this.isAuthenticated()) {
              this.setupTodoRealtimeSubscription();
            }
          }, 5000);
        } else if (status === 'SUBSCRIBED') {
          console.log('[MobileSync] Todo realtime subscription active');
          this.todoRealtimeConnected = true;
        }
      });
  }

  /**
   * Unsubscribe from todo realtime updates.
   */
  private teardownTodoRealtimeSubscription(): void {
    if (this.todoRealtimeChannel) {
      console.log('[MobileSync] Tearing down todo realtime subscription');
      this.supabase?.removeChannel(this.todoRealtimeChannel);
      this.todoRealtimeChannel = null;
    }
    this.todoRealtimeConnected = false;
  }

  // ===========================================================================
  // Profile Tier Realtime Subscription
  // Listens for changes to the user's tier (e.g., after Stripe checkout).
  // ===========================================================================

  /**
   * Subscribe to realtime changes on the user's profile row.
   * Emits 'tierChanged' when the tier is updated (e.g., free -> pro).
   */
  private setupProfileRealtimeSubscription(): void {
    const userId = this.session?.user?.id;
    if (!this.supabase || !userId) return;

    // Teardown existing subscription first.
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

  /**
   * Unsubscribe from profile realtime updates.
   */
  private teardownProfileRealtimeSubscription(): void {
    if (this.profileRealtimeChannel) {
      console.log('[MobileSync] Tearing down profile realtime subscription');
      this.supabase?.removeChannel(this.profileRealtimeChannel);
      this.profileRealtimeChannel = null;
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
    this.syncedSketchIds.clear();
    const transcriptCount = await this.syncTranscripts();
    const sketchCount = await this.syncSketches();
    return transcriptCount + sketchCount;
  }

  // ==========================================================================
  // Sketch Sync - Fetch sketches from iOS and add to clipboard history
  // ==========================================================================

  /**
   * Fetch new sketches from Supabase and add to clipboard history as images.
   * Downloads the PNG from storage and stores it locally.
   * 
   * @returns Number of sketches synced
   */
  async syncSketches(): Promise<number> {
    if (!this.supabase || !this.session) {
      return 0;
    }

    try {
      // Fetch sketch metadata from the sketch_items table.
      // Only get sketches from the last 7 days to avoid huge downloads.
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
        // Skip if we've already synced this sketch.
        if (this.syncedSketchIds.has(sketch.client_id)) {
          continue;
        }

        try {
          // Download the image from Supabase Storage.
          const { data: imageData, error: downloadError } = await this.supabase.storage
            .from('sketch-images')
            .download(sketch.image_path);

          if (downloadError || !imageData) {
            console.error(`[MobileSync] Failed to download sketch ${sketch.client_id}:`, downloadError);
            continue;
          }

          // Convert Blob to Buffer.
          const arrayBuffer = await imageData.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);

          // Create a NativeImage from the buffer.
          const { nativeImage } = await import('electron');
          const image = nativeImage.createFromBuffer(imageBuffer);

          if (image.isEmpty()) {
            console.error(`[MobileSync] Failed to create image from sketch ${sketch.client_id}`);
            continue;
          }

          // Store in clipboard history as an image with source='ios'.
          const itemId = await this.clipboardManager.storeImage(
            image,
            imageBuffer,
            'image', // Type is 'image' for sketches
            undefined, // No source app for iOS items.
            undefined, // No stack ID.
            'ios'
          );

          if (itemId > 0) {
            // If the sketch has a title, update the item's content field.
            if (sketch.title) {
              this.clipboardManager.updateItemContent(itemId, `Sketch: ${sketch.title}`);
            }
            
            this.syncedSketchIds.add(sketch.client_id);
            syncedCount++;
          }
        } catch (sketchError) {
          console.error(`[MobileSync] Error processing sketch ${sketch.client_id}:`, sketchError);
          // Continue with other sketches.
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
    this.teardownTodoRealtimeSubscription();
    this.stopPeriodicSync();
    this.session = null;
    this.removeAllListeners();
    console.log('[MobileSync] Destroyed');
  }
}
