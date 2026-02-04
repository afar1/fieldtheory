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

import { createClient, SupabaseClient, Session, SupportedStorage } from '@supabase/supabase-js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getUserDataManager, UserDataManager } from './userDataManager';
import { createLogger } from './logger';

const log = createLogger('Auth');

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
      const keys = Array.from(this.storage.keys());
      log.debug('getRawSessionData called, storage keys:', keys.length > 0 ? keys : '(empty)');

      // First try in-memory storage
      for (const [key, value] of this.storage.entries()) {
        const matchesPattern = authKeyPatterns.some(pattern => key.includes(pattern));
        if (matchesPattern) {
          const parsed = JSON.parse(value);
          if (parsed?.refresh_token) {
            log.debug('Found session data in memory, refresh_token length:', parsed.refresh_token.length);
            return parsed;
          }
        }
      }

      // Fallback: read directly from disk (SDK may have cleared in-memory storage)
      if (fs.existsSync(this.filePath)) {
        const diskData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        for (const [key, value] of Object.entries(diskData)) {
          const matchesPattern = authKeyPatterns.some(pattern => key.includes(pattern));
          if (matchesPattern && typeof value === 'string') {
            const parsed = JSON.parse(value);
            if (parsed?.refresh_token) {
              log.debug('Found session data on disk, refresh_token length:', parsed.refresh_token.length);
              return parsed;
            }
          }
        }
      }

      log.debug('No refresh_token found in memory or on disk');
    } catch (err) {
      log.warn('Failed to parse raw session:', err);
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
        log.debug('Loaded from disk, keys present:', keys.length > 0 ? keys : '(none)');
      } else {
        log.debug('No session file exists yet');
      }
    } catch (err) {
      log.warn('Failed to load session from disk:', err);
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
          log.debug('Skipping save - refusing to write empty session');
          this.hasLoggedEmptySkip = true;
        }
        return;
      }
      this.hasLoggedEmptySkip = false;  // Reset flag when we have real data to save

      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
    } catch (err) {
      log.warn('Failed to save session to disk:', err);
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
      log.info('Storage cleared (explicit sign-out)');
    } catch (err) {
      log.warn('Failed to clear storage:', err);
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
  private cachedTier: 'free' | 'pro' = 'free';

  private lastEmittedUserId: string | null = null;  // Dedupe sessionChanged events

  // Mutex to prevent concurrent refresh attempts.
  // With autoRefreshToken disabled, we control all refresh timing ourselves.
  private refreshInProgress: Promise<void> | null = null;

  // Timer for scheduled token refresh (replaces SDK's autoRefreshToken)
  private refreshTimer: NodeJS.Timeout | null = null;

  // Constants for refresh scheduling
  private static readonly REFRESH_MARGIN_MS = 60 * 1000; // 60 seconds before expiry
  private static readonly FALLBACK_REFRESH_MS = 30 * 60 * 1000; // 30 min if no expiry info
  private static readonly RETRY_DELAY_MS = 30 * 1000; // 30 seconds retry on failure

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
      log.warn('No Supabase credentials available');
      return;
    }

    const userDataPath = app.getPath('userData');
    this.fileStorage = new FileStorage(userDataPath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = createClient(url, anonKey, {
      auth: {
        storage: this.fileStorage,
        autoRefreshToken: false,  // DISABLED: We handle refresh ourselves to prevent race conditions
        persistSession: true,
        detectSessionInUrl: false,
        // NOTE: SDK's autoRefreshToken was causing race conditions with our coordinatedRefresh().
        // Both would try to use the same refresh_token, causing "already_used" errors.
        // Now we control ALL refresh timing via scheduleTokenRefresh().
      },
      realtime: {
        transport: WebSocket as any,
      },
    });

    // Listen to SDK auth state changes
    // Note: TOKEN_REFRESHED shouldn't fire anymore since autoRefreshToken is disabled,
    // but we handle it defensively just in case.
    // Dedupe: only emit if user actually changed (SDK fires multiple events on init)
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      const newUserId = session?.user?.id ?? null;
      const isNewSession = newUserId !== this.lastEmittedUserId;

      // Skip logging duplicate events entirely - only log new sessions
      if (!isNewSession && event !== 'SIGNED_OUT' && event !== 'TOKEN_REFRESHED') {
        return; // Duplicate event, nothing to do
      }
      if (isNewSession) {
        log.info('Auth state change:', event, session ? `user: ${session.user?.email}` : 'no session');
      }

      if (event === 'TOKEN_REFRESHED') {
        // Shouldn't happen with autoRefreshToken: false, but handle defensively
        log.debug('Token refreshed (unexpected with autoRefreshToken disabled)');
        this.session = session;
        this.scheduleTokenRefresh();
        // Don't emit sessionChanged for token refresh - session user didn't change
      } else if (event === 'SIGNED_OUT') {
        // Clear refresh timer on logout
        this.clearRefreshTimer();

        // Try recovery before accepting logout (SDK may have fired spuriously)
        const recovered = await this.attemptSessionRecovery();
        if (recovered) {
          log.info('Recovered session, ignoring spurious SIGNED_OUT');
          return;
        }

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

        // Schedule token refresh for this session
        this.scheduleTokenRefresh();
      }
    });

    log.info('Initialized with session storage:', userDataPath);
    await this.restoreSessionFromStorage();
  }

  /**
   * Restore session from file storage on startup.
   */
  private async restoreSessionFromStorage(): Promise<void> {
    if (!this.supabase) return;

    try {
      // Add timeout - getSession can hang in Electron due to SDK issues with Web Locks API
      const timeoutPromise = new Promise<{ data: { session: null }; error: null }>((resolve) => {
        setTimeout(() => {
          log.warn('getSession timeout after 5s - continuing without session');
          resolve({ data: { session: null }, error: null });
        }, 5000);
      });

      const sessionPromise = this.supabase.auth.getSession();
      const { data, error } = await Promise.race([sessionPromise, timeoutPromise]);

      if (error) {
        log.warn('Error getting session:', error.message);
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

        log.info('Restored session for user:', data.session.user?.email, userId ? `(${userId})` : '', shouldEmitUserChanged ? '(new)' : '(already emitted)');
        this.emit('sessionChanged', this.session);

        // Schedule token refresh for restored session
        this.scheduleTokenRefresh();
        return;
      }

      // getSession() returned null - attempt manual refresh
      log.debug('getSession() returned null, checking for stored refresh_token...');

      const rawSession = this.fileStorage?.getRawSessionData();
      log.debug('rawSession exists:', !!rawSession, 'has refresh_token:', !!rawSession?.refresh_token);

      if (rawSession?.refresh_token) {
        this.hasEverAuthenticated = true; // They had a session before

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = rawSession.expires_at || 0;
        const expiredAgoMinutes = Math.floor((now - expiresAt) / 60);

        log.debug('Stored session for:', rawSession.user?.email || 'unknown', `(expired ${expiredAgoMinutes} min ago)`);

        // Use coordinated refresh to prevent concurrent attempts
        await this.coordinatedRefresh(rawSession.refresh_token, 'restore');
      } else {
        log.debug('No stored session found - user must login');
      }
    } catch (err) {
      log.warn('Failed to restore session:', err);
    }
  }

  /**
   * Coordinated refresh - ensures only one refresh happens at a time.
   * Multiple callers will wait for the same refresh to complete.
   */
  private async coordinatedRefresh(refreshToken: string, source: string): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshInProgress) {
      log.debug(`Refresh already in progress, ${source} waiting...`);
      await this.refreshInProgress;
      return !!this.session;
    }

    // Start a new refresh operation
    log.debug(`Starting coordinated refresh from ${source}`);

    // Create a promise that other callers can wait on
    let resolveRefresh: () => void;
    this.refreshInProgress = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    try {
      log.debug('Calling supabase.auth.refreshSession...');

      // Add timeout to prevent hanging forever (Supabase SDK can hang on network issues)
      const REFRESH_TIMEOUT_MS = 10000;
      const refreshPromise = this.supabase!.auth.refreshSession({
        refresh_token: refreshToken,
      });
      const timeoutPromise = new Promise<{ data: { session: null }; error: { message: string } }>((resolve) => {
        setTimeout(() => {
          log.warn(`refreshSession timeout after ${REFRESH_TIMEOUT_MS}ms`);
          resolve({ data: { session: null }, error: { message: 'Refresh timeout' } });
        }, REFRESH_TIMEOUT_MS);
      });

      const { data: refreshData, error: refreshError } = await Promise.race([refreshPromise, timeoutPromise]);
      log.debug('refreshSession returned, error:', refreshError?.message || 'none', 'hasSession:', !!refreshData?.session);

      if (refreshError) {
        if (this.isTokenRevoked(refreshError)) {
          // Belt-and-suspenders: before logging out, check if we actually have a valid session
          // This handles edge cases where refresh succeeded via another path
          log.warn(`Token error (${source}): ${refreshError.message} - checking for valid session...`);

          try {
            const { data: currentSession } = await this.supabase!.auth.getSession();
            if (currentSession?.session?.access_token && currentSession.session.user) {
              log.info('Token error but valid session exists - recovering');
              this.session = currentSession.session;
              this.scheduleTokenRefresh();
              return true; // Recovered!
            }
          } catch (checkErr) {
            log.debug('Session check failed:', checkErr);
          }

          // No valid session found - this is a real logout
          log.warn(`Refresh token revoked (${source}), user must re-login`);
          this.fileStorage?.clearStorage();
          return false;
        } else {
          // Network error - will retry via scheduled refresh
          log.warn(`Error during ${source} refresh:`, refreshError.message);
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

        log.info(`Refresh succeeded (${source}) for user:`, refreshData.session.user?.email, userId ? `(${userId})` : '', shouldEmitUserChanged ? '(new)' : '(already emitted)');
        this.emit('sessionChanged', this.session);

        // Schedule next refresh
        this.scheduleTokenRefresh();

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
   * Attempt to recover session when SDK fires spurious SIGNED_OUT.
   * FileStorage preserves disk data when SDK clears memory, so we read directly from disk.
   */
  private async attemptSessionRecovery(): Promise<boolean> {
    const sessionPath = path.join(app.getPath('userData'), 'supabase-session.json');
    try {
      if (!fs.existsSync(sessionPath)) return false;

      const diskData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      for (const value of Object.values(diskData)) {
        if (typeof value === 'string') {
          const parsed = JSON.parse(value);
          if (parsed?.refresh_token) {
            log.debug('Found disk-preserved refresh token, attempting recovery...');
            return await this.coordinatedRefresh(parsed.refresh_token, 'recovery');
          }
        }
      }
    } catch (err) {
      log.warn('Recovery failed:', err);
    }
    return false;
  }

  /**
   * Set session from renderer process.
   */
  async setSession(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.supabase) {
      log.warn('Cannot set session - Supabase not initialized');
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
      log.debug('Access token expired, attempting coordinated refresh...');

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

      // Schedule token refresh
      this.scheduleTokenRefresh();
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

    this.clearRefreshTimer();
    this.session = null;
    log.info('Session cleared');
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

    log.info('Signing up:', email);
    const { error } = await this.supabase.auth.signUp({ email, password });

    if (error) {
      log.error('Sign up failed:', error);
      return { error: error.message };
    }

    log.info('Sign up successful, verification email sent to:', email);
    return { error: null };
  }

  async signInWithPassword(email: string, password: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    log.info('Signing in with password for:', email);

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

      if (error) {
        log.error('Sign in failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        this.hasEverAuthenticated = true;
        log.info('Signed in for:', data.session.user?.email);
        this.emit('sessionChanged', this.session);

        // Schedule token refresh
        this.scheduleTokenRefresh();

        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Sign in exception:', message);
      return { error: message, session: null };
    }
  }

  async requestOtp(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    log.info('Requesting OTP for:', email);

    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) {
        log.error('OTP request failed:', error);
        return { error: error.message };
      }

      log.info('OTP sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('OTP request exception:', message);
      return { error: message };
    }
  }

  async verifyOtp(email: string, token: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    log.info('Verifying OTP for:', email);

    try {
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        log.error('OTP verification failed:', error);
        return { error: error.message, session: null };
      }

      if (data.session) {
        this.session = data.session;
        this.hasEverAuthenticated = true;
        log.info('OTP verified for:', data.session.user?.email);
        this.emit('sessionChanged', this.session);

        // Schedule token refresh
        this.scheduleTokenRefresh();

        return { error: null, session: data.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('OTP verification exception:', message);
      return { error: message, session: null };
    }
  }

  async requestPasswordReset(email: string): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    log.info('Requesting password reset for:', email);

    try {
      const redirectUrl = this.getPasswordResetUrl();
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl || undefined,
      });

      if (error) {
        log.error('Password reset email failed:', error);

        const rateLimitMatch = error.message.match(/after (\d+) seconds?/i);
        if (rateLimitMatch) {
          return { error: `Please wait ${rateLimitMatch[1]} seconds before requesting another reset.` };
        }

        return { error: error.message };
      }

      log.info('Password reset email sent to:', email);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Password reset exception:', message);
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

    log.info('Updating password...');

    try {
      const { error } = await this.supabase.auth.updateUser({ password: newPassword });

      if (error) {
        log.error('Password update failed:', error);
        return { error: error.message };
      }

      log.info('Password updated successfully');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Password update exception:', message);
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

    log.info('Updating full name...');

    try {
      const { data, error } = await this.supabase.auth.updateUser({
        data: { full_name: fullName }
      });

      if (error) {
        log.error('Full name update failed:', error);
        return { error: error.message };
      }

      // Update local session with new user data
      if (data.user && this.session) {
        this.session = { ...this.session, user: data.user };
      }

      log.info('Full name updated successfully');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Full name update exception:', message);
      return { error: message };
    }
  }

  async setSessionFromUrl(accessToken: string, refreshToken: string): Promise<{ error: string | null; session: Session | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized', session: null };
    }

    log.info('Setting session from recovery token...');

    try {
      await this.setSession(accessToken, refreshToken);

      if (this.session) {
        log.info('Session established from recovery token for:', this.session.user?.email);
        return { error: null, session: this.session };
      }

      return { error: 'No session returned', session: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Set session exception:', message);
      return { error: message, session: null };
    }
  }

  /**
   * Clear session storage to prepare for fresh login.
   * Call before requestOtp() when starting a new login flow.
   */
  prepareForNewLogin(): void {
    log.info('Clearing session for new login');
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
        log.error('Sign out failed:', error);
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
      log.error('Sign out exception:', message);
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

    log.info('Deleting account for user:', userId);

    try {
      const { error } = await this.supabase.rpc('delete_user');

      if (error) {
        log.error('Delete account failed:', error);
        return { error: error.message };
      }

      // Delete local user data (GDPR compliance - right to erasure)
      const userDataManager = getUserDataManager();
      if (userDataManager) {
        await userDataManager.deleteCurrentUserData();
        log.info('Local user data deleted');
      }

      this.clearSession();
      this.fileStorage?.clearStorage();
      log.info('Account deleted');
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Delete account exception:', message);
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

  // ===========================================================================
  // Token Refresh Scheduling (replaces SDK's autoRefreshToken)
  // ===========================================================================

  /**
   * Schedule the next token refresh.
   * Called after any successful session update.
   */
  private scheduleTokenRefresh(): void {
    this.clearRefreshTimer();

    if (!this.session?.refresh_token) {
      log.debug('No refresh token, skipping refresh scheduling');
      return;
    }

    let delay: number;
    if (this.session.expires_at) {
      const expiresAt = this.session.expires_at * 1000; // Convert to ms
      const refreshAt = expiresAt - AuthManager.REFRESH_MARGIN_MS;
      delay = Math.max(refreshAt - Date.now(), 0);
    } else {
      // No expiry info - use conservative fallback
      delay = AuthManager.FALLBACK_REFRESH_MS;
      log.warn('No expires_at on session, using fallback refresh interval');
    }

    log.debug(`Scheduling token refresh in ${Math.round(delay / 1000)}s`);

    this.refreshTimer = setTimeout(async () => {
      if (!this.session?.refresh_token) {
        log.debug('No refresh token when timer fired, skipping');
        return;
      }

      try {
        const success = await this.coordinatedRefresh(this.session.refresh_token, 'scheduled');
        if (success) {
          // coordinatedRefresh will call scheduleTokenRefresh again on success
          log.debug('Scheduled refresh succeeded');
        } else {
          // Retry after delay
          log.warn('Scheduled refresh failed, retrying...');
          this.refreshTimer = setTimeout(() => {
            if (this.session?.refresh_token) {
              this.coordinatedRefresh(this.session.refresh_token, 'retry');
            }
          }, AuthManager.RETRY_DELAY_MS);
        }
      } catch (err) {
        log.error('Scheduled refresh error:', err);
        // Retry after delay
        this.refreshTimer = setTimeout(() => {
          if (this.session?.refresh_token) {
            this.coordinatedRefresh(this.session.refresh_token, 'retry');
          }
        }, AuthManager.RETRY_DELAY_MS);
      }
    }, delay);
  }

  /**
   * Clear the refresh timer.
   */
  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Check if the current token is expiring soon (within REFRESH_MARGIN_MS).
   * Used by power monitor wake handler.
   */
  isTokenExpiringSoon(): boolean {
    if (!this.session?.expires_at) return true; // No expiry info = assume needs refresh
    const expiresAt = this.session.expires_at * 1000;
    return Date.now() > expiresAt - AuthManager.REFRESH_MARGIN_MS;
  }

  /**
   * Trigger a refresh if token is expiring soon.
   * Called by power monitor 'resume' handler.
   */
  async refreshIfExpiringSoon(): Promise<void> {
    if (this.session?.refresh_token && this.isTokenExpiringSoon()) {
      log.info('Token expiring soon after wake, refreshing...');
      await this.coordinatedRefresh(this.session.refresh_token, 'wake');
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.clearRefreshTimer();
    this.session = null;
    this.removeAllListeners();
    log.info('Destroyed');
  }

  // ===========================================================================
  // Tier Management
  // ===========================================================================

  /**
   * Fetch and cache the user's tier from the profiles table.
   */
  async fetchTier(): Promise<void> {
    if (!this.supabase || !this.session) return;
    try {
      const { data } = await this.supabase
        .from('profiles')
        .select('tier')
        .eq('id', this.session.user.id)
        .single();

      const newTier = data?.tier || 'free';
      if (newTier !== this.cachedTier) {
        this.cachedTier = newTier;
        this.emit('tierChanged', newTier);
      }
    } catch (err) {
      // Keep existing tier on error
      log.warn('Failed to fetch tier:', err);
    }
  }

  /**
   * Get the cached user tier.
   */
  getTier(): 'free' | 'pro' {
    return this.cachedTier;
  }
}
