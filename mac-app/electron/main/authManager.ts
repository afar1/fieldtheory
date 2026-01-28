/**
 * AuthManager - Centralized authentication management for the main process.
 *
 * Single source of truth for Supabase authentication:
 * - Session persistence to disk (survives app updates)
 * - Smart token refresh (only clears on revocation, not network errors)
 * - Event emitter for session state changes
 *
 * All sync managers (MobileSync, SharedClipboardSync, SocialSync) subscribe
 * to this manager's events instead of managing their own auth state.
 */

import { createClient, SupabaseClient, Session, SupportedStorage, processLock } from '@supabase/supabase-js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getUserDataManager, UserDataManager } from './userDataManager';

// =============================================================================
// FileStorage - Persists session to disk for survival across app updates
// =============================================================================

class FileStorage implements SupportedStorage {
  private storage: Map<string, string> = new Map();
  private filePath: string;
  private hasLoggedEmptySkip: boolean = false;  // Only log "skipping save" once

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'supabase-session.json');
    this.loadFromDisk();
  }

  /**
   * Get raw session data for manual recovery when getSession() returns null
   * but we may still have a valid refresh_token.
   */
  getRawSessionData(): { access_token?: string; refresh_token?: string; expires_at?: number; user?: { email?: string } } | null {
    try {
      const authKeyPatterns = ['auth-token', 'supabase.auth.token', 'session'];

      for (const [key, value] of this.storage.entries()) {
        const matchesPattern = authKeyPatterns.some(pattern => key.includes(pattern));
        if (matchesPattern) {
          const parsed = JSON.parse(value);
          if (parsed?.refresh_token) {
            console.log('[FileStorage] Found session data under key:', key);
            return parsed;
          }
        }
      }

      const keys = Array.from(this.storage.keys());
      if (keys.length > 0) {
        console.log('[FileStorage] Storage keys present:', keys);
      } else {
        console.log('[FileStorage] Storage is empty');
      }
    } catch (err) {
      console.warn('[FileStorage] Failed to parse raw session:', err);
    }
    return null;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.storage = new Map(Object.entries(parsed));
        const keys = Array.from(this.storage.keys());
        console.log('[FileStorage] Loaded from disk, keys present:', keys.length > 0 ? keys : '(none)');
      } else {
        console.log('[FileStorage] No session file exists yet');
      }
    } catch (err) {
      console.warn('[FileStorage] Failed to load session from disk:', err);
    }
  }

  private saveToDisk(): void {
    try {
      const obj: Record<string, string> = {};
      this.storage.forEach((value, key) => {
        obj[key] = value;
      });

      // Never overwrite with empty data - preserves session for re-auth later.
      // Only explicit clearStorage() should write an empty file.
      if (Object.keys(obj).length === 0) {
        if (!this.hasLoggedEmptySkip) {
          console.log('[FileStorage] Skipping save - refusing to write empty session');
          this.hasLoggedEmptySkip = true;
        }
        return;
      }
      this.hasLoggedEmptySkip = false;  // Reset flag when we have real data to save

      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.warn('[FileStorage] Failed to save session to disk:', err);
    }
  }

  /**
   * Explicitly clear storage (for sign-out only).
   * This is the ONLY way to write an empty session file.
   */
  clearStorage(): void {
    this.storage.clear();
    try {
      fs.writeFileSync(this.filePath, '{}');
      console.log('[FileStorage] Storage cleared (explicit sign-out)');
    } catch (err) {
      console.warn('[FileStorage] Failed to clear storage:', err);
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

// =============================================================================
// AuthManager
// =============================================================================

export interface AuthManagerEvents {
  sessionChanged: (session: Session | null) => void;
  tierChanged: (tier: string) => void;
  userChanged: (callsign: string) => void;
  userLoggedOut: () => void;
}

export class AuthManager extends EventEmitter {
  private supabase: SupabaseClient | null = null;
  private session: Session | null = null;
  private fileStorage: FileStorage | null = null;
  private lastFailedToken: string | null = null;
  private hasEverAuthenticated: boolean = false;
  private userDataManager: UserDataManager | null = null;

  // Debug flags for testing auth states
  private simulateOffline: boolean = false;
  private simulateRevoked: boolean = false;
  private lastEmittedUserId: string | null = null;  // Dedupe sessionChanged events

  // Mutex to prevent concurrent refresh attempts.
  // Even with processLock in Supabase config, we add app-level protection
  // to ensure only one refresh operation runs at a time.
  private refreshInProgress: Promise<void> | null = null;

  constructor() {
    super();
  }

  /**
   * Set the UserDataManager instance for coordinating user data paths.
   */
  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
  }

  /**
   * Get the callsign from the current session.
   * Callsign is stored in user_metadata.callsign.
   */
  getCallsign(): string | null {
    if (!this.session?.user) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = this.session.user.user_metadata as any;
    return metadata?.callsign || null;
  }

  /**
   * Get the callsign from a session object.
   */
  private getCallsignFromSession(session: Session | null): string | null {
    if (!session?.user) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = session.user.user_metadata as any;
    return metadata?.callsign || null;
  }

  /**
   * Initialize the auth manager with Supabase credentials.
   */
  async init(supabaseUrl?: string, supabaseAnonKey?: string): Promise<void> {
    const url = supabaseUrl || process.env.VITE_SUPABASE_URL;
    const anonKey = supabaseAnonKey || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      console.log('[AuthManager] No Supabase credentials available');
      return;
    }

    const userDataPath = app.getPath('userData');
    this.fileStorage = new FileStorage(userDataPath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = createClient(url, anonKey, {
      auth: {
        storage: this.fileStorage,
        autoRefreshToken: true,  // SDK handles token refresh automatically
        persistSession: true,
        detectSessionInUrl: false,
        // CRITICAL: Use processLock to prevent concurrent refresh token attempts.
        // Without this, multiple callers (SDK auto-refresh, setSession, restoreSessionFromStorage)
        // can race and use the same refresh token, causing "refresh_token_already_used" errors.
        lock: processLock,
      },
      realtime: {
        transport: WebSocket as any,
      },
    });

    // Listen to SDK auth state changes (handles auto-refresh events)
    // Dedupe: only emit if user actually changed (SDK fires multiple events on init)
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      const newUserId = session?.user?.id ?? null;
      const isNewSession = newUserId !== this.lastEmittedUserId;

      console.log('[AuthManager] Auth state changed:', event, isNewSession ? '(new)' : '(duplicate)', newUserId ? `userId: ${newUserId}` : '');

      if (event === 'TOKEN_REFRESHED') {
        console.log('[AuthManager] Token refreshed by SDK');
        this.session = session;
        // Don't emit sessionChanged for token refresh - session user didn't change
      } else if (event === 'SIGNED_OUT') {
        if (this.lastEmittedUserId !== null) {
          this.session = null;
          this.lastEmittedUserId = null;

          // Coordinate with UserDataManager
          if (this.userDataManager) {
            await this.userDataManager.clearCurrentUser();
          }
          this.emit('userLoggedOut');
          this.emit('sessionChanged', null);
        }
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && isNewSession) {
        // Only emit if this is actually a new user session
        this.session = session;
        const previousUserId = this.lastEmittedUserId;
        this.lastEmittedUserId = newUserId;

        // Coordinate with UserDataManager - use user ID for per-user directories
        if (newUserId && this.userDataManager) {
          await this.userDataManager.setCurrentUser(newUserId);
          await this.userDataManager.migrateExistingData(newUserId);
          this.emit('userChanged', newUserId);
        }

        this.emit('sessionChanged', session);
      }
    });

    console.log('[AuthManager] Initialized with session storage:', userDataPath);
    await this.restoreSessionFromStorage();
  }

  /**
   * Restore session from file storage on startup.
   */
  private async restoreSessionFromStorage(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase.auth.getSession();

      if (error) {
        console.log('[AuthManager] Error getting session:', error.message);
      }

      if (data?.session) {
        this.session = data.session;
        this.hasEverAuthenticated = true;
        const userId = data.session.user?.id ?? null;

        // Only emit userChanged if onAuthStateChange hasn't already done so
        const shouldEmitUserChanged = userId !== this.lastEmittedUserId;
        this.lastEmittedUserId = userId;

        // Coordinate with UserDataManager - use user ID for per-user directories
        if (shouldEmitUserChanged && userId && this.userDataManager) {
          await this.userDataManager.setCurrentUser(userId);
          await this.userDataManager.migrateExistingData(userId);
          this.emit('userChanged', userId);
        }

        console.log('[AuthManager] Restored session for user:', data.session.user?.email, userId ? `(${userId})` : '', shouldEmitUserChanged ? '(new)' : '(already emitted)');
        this.emit('sessionChanged', this.session);
        return;
      }

      // getSession() returned null - attempt manual refresh
      console.log('[AuthManager] getSession() returned null, checking for stored refresh_token...');

      const rawSession = this.fileStorage?.getRawSessionData();
      if (rawSession?.refresh_token) {
        this.hasEverAuthenticated = true; // They had a session before

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = rawSession.expires_at || 0;
        const expiredAgoMinutes = Math.floor((now - expiresAt) / 60);

        console.log('[AuthManager] Stored session diagnostic:', {
          user: rawSession.user?.email || 'unknown',
          hasRefreshToken: true,
          accessTokenExpiredAgo: `${expiredAgoMinutes} minutes`,
        });

        // Use coordinated refresh to prevent concurrent attempts
        await this.coordinatedRefresh(rawSession.refresh_token, 'restore');
      } else {
        console.log('[AuthManager] No stored session found - user must login');
      }
    } catch (err) {
      console.warn('[AuthManager] Failed to restore session:', err);
    }
  }

  /**
   * Coordinated refresh - ensures only one refresh happens at a time.
   * Multiple callers will wait for the same refresh to complete.
   */
  private async coordinatedRefresh(refreshToken: string, source: string): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshInProgress) {
      console.log(`[AuthManager] Refresh already in progress, ${source} waiting...`);
      await this.refreshInProgress;
      // After waiting, check if we now have a session
      return !!this.session;
    }

    // Start a new refresh operation
    console.log(`[AuthManager] Starting coordinated refresh from ${source}...`);

    // Create a promise that other callers can wait on
    let resolveRefresh: () => void;
    this.refreshInProgress = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    try {
      const { data: refreshData, error: refreshError } = await this.supabase!.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (refreshError) {
        if (this.isTokenRevoked(refreshError)) {
          console.log(`[AuthManager] Refresh token revoked (${source}), user must re-login`);
          return false;
        } else {
          // Network error - SDK will retry automatically via autoRefreshToken
          console.log(`[AuthManager] Network error during ${source} refresh, SDK will retry:`, refreshError.message);
          return false;
        }
      }

      if (refreshData.session) {
        this.session = refreshData.session;
        const userId = refreshData.session.user?.id ?? null;

        // Only emit userChanged if onAuthStateChange hasn't already done so
        const shouldEmitUserChanged = userId !== this.lastEmittedUserId;
        this.lastEmittedUserId = userId;

        // Coordinate with UserDataManager - use user ID for per-user directories
        if (shouldEmitUserChanged && userId && this.userDataManager) {
          await this.userDataManager.setCurrentUser(userId);
          await this.userDataManager.migrateExistingData(userId);
          this.emit('userChanged', userId);
        }

        console.log(`[AuthManager] Refresh succeeded (${source}) for user:`, refreshData.session.user?.email, userId ? `(${userId})` : '', shouldEmitUserChanged ? '(new)' : '(already emitted)');
        this.emit('sessionChanged', this.session);
        return true;
      }

      return false;
    } finally {
      // Always clear the in-progress flag
      this.refreshInProgress = null;
      resolveRefresh!();
    }
  }

  /**
   * Set session from renderer process.
   */
  async setSession(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.supabase) {
      console.warn('[AuthManager] Cannot set session - Supabase not initialized');
      return;
    }

    if (this.lastFailedToken === accessToken) {
      return; // Skip duplicate failed token
    }

    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.log('[AuthManager] Access token expired, attempting coordinated refresh...');

      // Use coordinated refresh to prevent concurrent attempts with restoreSessionFromStorage
      // or SDK auto-refresh
      const success = await this.coordinatedRefresh(refreshToken, 'setSession');

      if (!success) {
        if (this.isTokenRevoked({ message: 'refresh failed' })) {
          this.lastFailedToken = accessToken;
          this.clearSession();
        }
        return;
      }
    } else {
      this.lastFailedToken = null;
      this.session = data.session;
      this.hasEverAuthenticated = true;
      this.emit('sessionChanged', this.session);
    }
  }

  /**
   * Check if error indicates token was revoked (not a network error).
   */
  private isTokenRevoked(error: { message?: string; code?: string } | null): boolean {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();

    return msg.includes('invalid_grant') ||
           msg.includes('token expired') ||
           msg.includes('token revoked') ||
           msg.includes('refresh token not found') ||
           msg.includes('already used') ||
           code === 'invalid_grant' ||
           code === 'refresh_token_already_used';
  }

  /**
   * Check if error is network-related (retryable).
   */
  private isNetworkError(error: { message?: string } | null): boolean {
    if (!error?.message) return false;
    const msg = error.message.toLowerCase();
    return msg.includes('fetch') ||
           msg.includes('network') ||
           msg.includes('timeout') ||
           msg.includes('econnrefused') ||
           msg.includes('etimedout') ||
           msg.includes('socket');
  }

  /**
   * Clear session (called on sign out or token revocation).
   */
  clearSession(): void {
    if (!this.session) return; // Already cleared - idempotent

    this.session = null;
    console.log('[AuthManager] Session cleared');
    this.emit('sessionChanged', null);
  }

  /**
   * Get current session.
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Get Supabase client for direct queries.
   */
  getSupabaseClient(): SupabaseClient | null {
    return this.supabase;
  }

  /**
   * Check if authenticated.
   */
  isAuthenticated(): boolean {
    return !!(this.supabase && this.session);
  }

  /**
   * Check if user is a super admin.
   * Checks user_metadata.is_super_admin (set via Supabase dashboard).
   */
  isSuperAdmin(): boolean {
    if (!this.session?.user) return false;
    // Check user_metadata for is_super_admin flag
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = this.session.user.user_metadata as any;
    return metadata?.is_super_admin === true;
  }

  /**
   * Check if user has ever been authenticated (for determining new vs returning user).
   */
  hasEverBeenAuthenticated(): boolean {
    return this.hasEverAuthenticated;
  }

  // ===========================================================================
  // Auth Methods (OTP, password, etc.)
  // ===========================================================================

  async signUp(email: string, password: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[AuthManager] Signing up:', email);
    const { error } = await this.supabase.auth.signUp({ email, password });

    if (error) {
      console.error('[AuthManager] Sign up failed:', error);
      return { error: error.message };
    }

    console.log('[AuthManager] Sign up successful, verification email sent to:', email);
    return { error: null };
  }

  async signInWithPassword(email: string, password: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[AuthManager] Signing in with password for:', email);

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

      if (error) {
        console.error('[AuthManager] Sign in failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        this.hasEverAuthenticated = true;
        console.log('[AuthManager] Signed in for:', data.session.user?.email);
        this.emit('sessionChanged', this.session);
        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Sign in exception:', message);
      return { error: message, session: null };
    }
  }

  async requestOtp(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[AuthManager] Requesting OTP for:', email);

    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) {
        console.error('[AuthManager] OTP request failed:', error);
        return { error: error.message };
      }

      console.log('[AuthManager] OTP sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] OTP request exception:', message);
      return { error: message };
    }
  }

  async verifyOtp(email: string, token: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[AuthManager] Verifying OTP for:', email);

    try {
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        console.error('[AuthManager] OTP verification failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        this.hasEverAuthenticated = true;
        console.log('[AuthManager] OTP verified for:', data.session.user?.email);
        this.emit('sessionChanged', this.session);
        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] OTP verification exception:', message);
      return { error: message, session: null };
    }
  }

  async requestPasswordReset(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    console.log('[AuthManager] Requesting password reset for:', email);

    try {
      const redirectUrl = this.getPasswordResetUrl();
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl || undefined,
      });

      if (error) {
        console.error('[AuthManager] Password reset email failed:', error);

        const rateLimitMatch = error.message.match(/after (\d+) seconds?/i);
        if (rateLimitMatch) {
          return { error: `Please wait ${rateLimitMatch[1]} seconds before requesting another reset.` };
        }

        return { error: error.message };
      }

      console.log('[AuthManager] Password reset email sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Password reset exception:', message);
      return { error: message };
    }
  }

  /**
   * Alias for requestPasswordReset - maintains compatibility with IPC handler naming.
   */
  async resetPasswordForEmail(email: string): Promise<{ error: string | null }> {
    return this.requestPasswordReset(email);
  }

  async updatePassword(newPassword: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    if (!this.session) {
      return { error: 'No active session - click the reset link in your email first' };
    }

    console.log('[AuthManager] Updating password...');

    try {
      const { error } = await this.supabase.auth.updateUser({ password: newPassword });

      if (error) {
        console.error('[AuthManager] Password update failed:', error);
        return { error: error.message };
      }

      console.log('[AuthManager] Password updated successfully');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Password update exception:', message);
      return { error: message };
    }
  }

  /**
   * Update user's full name in user_metadata.
   */
  async updateFullName(fullName: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    if (!this.session) {
      return { error: 'No active session' };
    }

    console.log('[AuthManager] Updating full name...');

    try {
      const { data, error } = await this.supabase.auth.updateUser({
        data: { full_name: fullName }
      });

      if (error) {
        console.error('[AuthManager] Full name update failed:', error);
        return { error: error.message };
      }

      // Update local session with new user data
      if (data.user && this.session) {
        this.session = { ...this.session, user: data.user };
      }

      console.log('[AuthManager] Full name updated successfully');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Full name update exception:', message);
      return { error: message };
    }
  }

  async setSessionFromUrl(accessToken: string, refreshToken: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    console.log('[AuthManager] Setting session from recovery token...');

    try {
      await this.setSession(accessToken, refreshToken);

      if (this.session) {
        console.log('[AuthManager] Session established from recovery token for:', this.session.user?.email);
        return { error: null, session: this.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Set session exception:', message);
      return { error: message, session: null };
    }
  }

  /**
   * Clear session storage to prepare for fresh login.
   * Call before requestOtp() when starting a new login flow.
   */
  prepareForNewLogin(): void {
    console.log('[AuthManager] Clearing session for new login');
    this.fileStorage?.clearStorage();
    this.session = null;
    this.lastEmittedUserId = null;
  }

  async signOut(): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    try {
      const { error } = await this.supabase.auth.signOut();

      if (error) {
        console.error('[AuthManager] Sign out failed:', error);
        return { error: error.message };
      }

      // Coordinate with UserDataManager before clearing session
      if (this.userDataManager) {
        await this.userDataManager.clearCurrentUser();
      }
      this.emit('userLoggedOut');

      this.clearSession();
      // Explicitly clear the session file (only place this should happen)
      this.fileStorage?.clearStorage();
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Sign out exception:', message);
      return { error: message };
    }
  }

  /**
   * Delete user account.
   */
  async deleteAccount(): Promise<{ error: string | null }> {
    if (!this.supabase || !this.session) {
      return { error: 'Not authenticated' };
    }

    const userId = this.session.user?.id;
    if (!userId) {
      return { error: 'No user ID' };
    }

    console.log('[AuthManager] Deleting account for user:', userId);

    try {
      const { error } = await this.supabase.rpc('delete_user');

      if (error) {
        console.error('[AuthManager] Delete account failed:', error);
        return { error: error.message };
      }

      this.clearSession();
      this.fileStorage?.clearStorage();
      console.log('[AuthManager] Account deleted');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthManager] Delete account exception:', message);
      return { error: message };
    }
  }

  private getPasswordResetUrl(): string | null {
    if (process.env.VITE_PASSWORD_RESET_URL) {
      return process.env.VITE_PASSWORD_RESET_URL;
    }

    const envPaths: string[] = [
      path.join(__dirname, '../../.env.local'),
      path.join(process.cwd(), '.env.local'),
      path.join(process.cwd(), 'mac-app/.env.local'),
    ];

    try {
      if (app?.isReady()) {
        envPaths.push(
          path.join(app.getAppPath(), '.env.local'),
          path.join(app.getAppPath(), '../.env.local')
        );
      }
    } catch {
      // App not available yet
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
                return valueParts.join('=').trim();
              }
            }
          }
        }
      } catch {
        // Ignore, try next path
      }
    }

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      return 'http://localhost:5173/reset-password.html';
    }

    return 'https://afar1.github.io/field-theory/reset-password.html';
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.session = null;
    this.removeAllListeners();
    console.log('[AuthManager] Destroyed');
  }

  // ===========================================================================
  // Auth State Simulator (for testing)
  // ===========================================================================

  /**
   * Simulate different auth states for testing.
   * Only available in development mode.
   */
  async simulateState(
    state: 'NEW_USER' | 'RETURNING_VALID' | 'RETURNING_EXPIRED' | 'OFFLINE_MODE' | 'TOKEN_REVOKED' | 'SIGNED_OUT',
    options?: { tier?: 'free' | 'pro' }
  ): Promise<{ success: boolean; message: string }> {
    if (process.env.NODE_ENV !== 'development') {
      return { success: false, message: 'Simulator only available in development mode' };
    }

    console.log(`[AuthManager] Simulating state: ${state}`, options || '');

    switch (state) {
      case 'NEW_USER':
      case 'SIGNED_OUT':
        // Clear everything - user must re-authenticate
        this.fileStorage?.clearStorage();
        this.session = null;
        this.hasEverAuthenticated = state === 'SIGNED_OUT'; // SIGNED_OUT = was authenticated before
        this.simulateOffline = false;
        this.simulateRevoked = false;
        this.emit('sessionChanged', null);
        return { success: true, message: `Simulated ${state}: session cleared, showing onboarding` };

      case 'RETURNING_VALID':
        // Create a mock valid session
        const mockSession = this.createMockSession(options?.tier || 'free', false);
        this.session = mockSession;
        this.hasEverAuthenticated = true;
        this.simulateOffline = false;
        this.simulateRevoked = false;
        this.emit('sessionChanged', mockSession);
        return { success: true, message: `Simulated RETURNING_VALID: ${options?.tier || 'free'} user with valid session` };

      case 'RETURNING_EXPIRED':
        // Create an expired session - SDK will attempt refresh
        const expiredSession = this.createMockSession(options?.tier || 'free', true);
        this.session = null; // Expired = no in-memory session
        this.hasEverAuthenticated = true;
        this.simulateOffline = false;
        this.simulateRevoked = false;
        // Store in file storage so SDK can attempt refresh
        if (this.fileStorage) {
          const sessionKey = 'sb-session';
          await this.fileStorage.setItem(sessionKey, JSON.stringify(expiredSession));
        }
        this.emit('sessionChanged', null);
        return { success: true, message: 'Simulated RETURNING_EXPIRED: session expired, SDK will attempt refresh' };

      case 'OFFLINE_MODE':
        // Keep current session, simulate network failure
        this.simulateOffline = true;
        this.simulateRevoked = false;
        return { success: true, message: 'Simulated OFFLINE_MODE: network requests will fail' };

      case 'TOKEN_REVOKED':
        // Next refresh will return revoked error
        this.simulateRevoked = true;
        this.simulateOffline = false;
        return { success: true, message: 'Simulated TOKEN_REVOKED: next refresh will fail with revoked error' };

      default:
        return { success: false, message: `Unknown state: ${state}` };
    }
  }

  /**
   * Reset simulator flags.
   */
  resetSimulator(): void {
    this.simulateOffline = false;
    this.simulateRevoked = false;
    console.log('[AuthManager] Simulator reset');
  }

  /**
   * Create a mock session for testing.
   */
  private createMockSession(tier: 'free' | 'pro', expired: boolean): Session {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = expired ? now - 3600 : now + 3600; // -1hr or +1hr

    return {
      access_token: `mock_access_token_${Date.now()}`,
      refresh_token: `mock_refresh_token_${Date.now()}`,
      expires_at: expiresAt,
      expires_in: expired ? -3600 : 3600,
      token_type: 'bearer',
      user: {
        id: 'mock-user-id-12345',
        aud: 'authenticated',
        role: 'authenticated',
        email: `test-${tier}@example.com`,
        email_confirmed_at: new Date().toISOString(),
        phone: '',
        confirmed_at: new Date().toISOString(),
        last_sign_in_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { tier },
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  }

  /**
   * Get current simulator state (for debugging).
   */
  getSimulatorState(): { offline: boolean; revoked: boolean } {
    return {
      offline: this.simulateOffline,
      revoked: this.simulateRevoked,
    };
  }
}
