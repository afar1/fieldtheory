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

// =============================================================================
// FileStorage - Persists session to disk for survival across app updates
// =============================================================================

class FileStorage implements SupportedStorage {
  private storage: Map<string, string> = new Map();
  private filePath: string;

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

// =============================================================================
// AuthManager
// =============================================================================

export interface AuthManagerEvents {
  sessionChanged: (session: Session | null) => void;
  tierChanged: (tier: string) => void;
}

export class AuthManager extends EventEmitter {
  private supabase: SupabaseClient | null = null;
  private session: Session | null = null;
  private fileStorage: FileStorage | null = null;
  private lastFailedToken: string | null = null;
  private refreshRetryTimeout: NodeJS.Timeout | null = null;
  private hasEverAuthenticated: boolean = false;

  constructor() {
    super();
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
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        transport: WebSocket as any,
      },
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
        console.log('[AuthManager] Restored session for user:', data.session.user?.email);
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

        console.log('[AuthManager] Attempting manual refresh with stored refresh_token...');

        const { data: refreshData, error: refreshError } = await this.supabase.auth.refreshSession({
          refresh_token: rawSession.refresh_token,
        });

        if (refreshError) {
          if (this.isTokenRevoked(refreshError)) {
            console.log('[AuthManager] Refresh token revoked, user must re-login');
            // Don't emit sessionChanged here - they weren't logged in yet
          } else {
            console.log('[AuthManager] Network error during restore, will retry later:', refreshError.message);
            this.scheduleRefreshRetry();
          }
          return;
        }

        if (refreshData.session) {
          this.session = refreshData.session;
          console.log('[AuthManager] Manual refresh succeeded for user:', refreshData.session.user?.email);
          this.emit('sessionChanged', this.session);
          return;
        }
      }

      console.log('[AuthManager] No stored session found - user must login');
    } catch (err) {
      console.warn('[AuthManager] Failed to restore session:', err);
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
      console.log('[AuthManager] Access token expired, attempting refresh...');

      const refreshResult = await this.supabase.auth.refreshSession({ refresh_token: refreshToken });

      if (refreshResult.error || !refreshResult.data.session) {
        if (this.isTokenRevoked(refreshResult.error)) {
          this.lastFailedToken = accessToken;
          console.log('[AuthManager] Token revoked:', refreshResult.error?.message);
          this.clearSession();
          return;
        }

        // Network error - don't clear session, schedule retry
        console.log('[AuthManager] Network error during refresh, will retry:', refreshResult.error?.message);
        this.scheduleRefreshRetry();
        return;
      }

      console.log('[AuthManager] Session refreshed for user:', refreshResult.data.session.user?.email);
      this.session = refreshResult.data.session;
    } else {
      this.lastFailedToken = null;
      this.session = data.session;
    }

    this.hasEverAuthenticated = true;
    this.emit('sessionChanged', this.session);
  }

  /**
   * Refresh session if needed (called when app becomes active).
   */
  async refreshSessionIfNeeded(force: boolean = false): Promise<boolean> {
    if (!this.supabase || !this.session) {
      return false;
    }

    const expiresAt = this.session.expires_at;
    if (!expiresAt) return !!this.session;

    const now = Math.floor(Date.now() / 1000);
    const fiveMinutes = 5 * 60;
    const isExpired = expiresAt <= now;
    const isExpiringSoon = expiresAt - now < fiveMinutes;

    if (force || isExpired || isExpiringSoon) {
      const reason = isExpired ? 'expired' : (force ? 'forced' : 'expiring soon');
      console.log(`[AuthManager] Token ${reason}, refreshing session...`);

      const { data, error } = await this.supabase.auth.refreshSession();

      if (error || !data.session) {
        if (this.isTokenRevoked(error)) {
          console.log('[AuthManager] Token revoked during refresh');
          this.clearSession();
          return false;
        }

        // Network error - keep session, schedule retry
        console.log('[AuthManager] Network error during refresh, keeping session:', error?.message);
        this.scheduleRefreshRetry();
        return true; // Return true because we still have a session
      }

      this.session = data.session;
      console.log('[AuthManager] Session refreshed, new expiry:',
        new Date((data.session.expires_at || 0) * 1000).toISOString());
      this.emit('sessionChanged', this.session);
      return true;
    }

    return true;
  }

  /**
   * Schedule a retry for refresh after network error.
   */
  private scheduleRefreshRetry(): void {
    if (this.refreshRetryTimeout) return; // Already scheduled

    console.log('[AuthManager] Scheduling refresh retry in 30 seconds...');
    this.refreshRetryTimeout = setTimeout(async () => {
      this.refreshRetryTimeout = null;
      if (this.session) {
        await this.refreshSessionIfNeeded(true);
      }
    }, 30000);
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
           code === 'invalid_grant';
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

      this.clearSession();
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
    if (this.refreshRetryTimeout) {
      clearTimeout(this.refreshRetryTimeout);
      this.refreshRetryTimeout = null;
    }
    this.session = null;
    this.removeAllListeners();
    console.log('[AuthManager] Destroyed');
  }
}
