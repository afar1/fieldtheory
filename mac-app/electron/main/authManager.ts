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
import os from 'os';
import { app } from 'electron';
import { getUserDataManager, UserDataManager } from './userDataManager';
import { createLogger } from './logger';

const log = createLogger('Auth');
const CLI_SESSION_PATH = path.join(os.homedir(), '.fieldtheory', 'session.json');

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
  getRawSessionData(): Partial<Session> | null {
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

export interface AuthDebugEvent {
  timestamp: string;
  event: string;
  details: Record<string, unknown>;
  level: 'info' | 'warn' | 'error' | 'recovery';
}

export interface AuthManagerEvents {
  sessionChanged: (session: Session | null) => void;
  tierChanged: (tier: string) => void;
  userChanged: (callsign: string) => void;
  userLoggedOut: () => void;
  authDebug: (event: AuthDebugEvent) => void;
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
  private wakeRefreshRetryTimer: NodeJS.Timeout | null = null;

  // Constants for refresh scheduling
  private static readonly REFRESH_MARGIN_MS = 60 * 1000; // 60 seconds before expiry
  private static readonly FALLBACK_REFRESH_MS = 30 * 60 * 1000; // 30 min if no expiry info
  private static readonly RETRY_DELAY_MS = 30 * 1000; // 30 seconds retry on failure

  // Track failed recovery to prevent infinite retry loops when SDK keeps firing SIGNED_OUT
  private lastFailedRecoveryTime: number = 0;
  private static readonly RECOVERY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between recovery attempts

  // Flag to skip recovery on intentional sign-out (user clicked sign out button)
  private intentionalSignOut: boolean = false;

  constructor() {
    super();
  }

  /**
   * Emit a debug event for monitoring auth behavior.
   * These events are forwarded to renderer for DevTools visibility.
   */
  private emitDebug(event: string, details: Record<string, unknown>, level: AuthDebugEvent['level'] = 'info'): void {
    // Only emit/log warnings, errors, and recovery events (info is too noisy)
    if (level === 'info') return;

    const debugEvent: AuthDebugEvent = {
      timestamp: new Date().toISOString(),
      event,
      details,
      level,
    };
    this.emit('authDebug', debugEvent);

    if (level === 'error') {
      log.error(`[AuthDebug] ${event}:`, JSON.stringify(details));
    } else if (level === 'warn') {
      log.warn(`[AuthDebug] ${event}:`, JSON.stringify(details));
    } else if (level === 'recovery') {
      log.info(`[AuthDebug] RECOVERY ${event}:`, JSON.stringify(details));
    }
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

  private getDisplayNameFromSession(session: Session | null): string | undefined {
    if (!session?.user) return undefined;
    const metadata = session.user.user_metadata as Record<string, unknown>;
    const displayName = metadata?.full_name || metadata?.display_name || metadata?.name;
    return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : undefined;
  }

  private writeCliSessionMirror(session: Session | null): void {
    const userId = session?.user?.id;
    const email = session?.user?.email;
    if (!userId || !email) return;

    const payload: {
      user_id: string;
      email: string;
      display_name?: string;
      expires_at: string;
    } = {
      user_id: userId,
      email,
      expires_at: new Date((session.expires_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    };
    const displayName = this.getDisplayNameFromSession(session);
    if (displayName) {
      payload.display_name = displayName;
    }

    try {
      fs.mkdirSync(path.dirname(CLI_SESSION_PATH), { recursive: true });
      const tempPath = `${CLI_SESSION_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
      fs.renameSync(tempPath, CLI_SESSION_PATH);
    } catch (err) {
      log.warn('Failed to write CLI session mirror:', err);
    }
  }

  private clearCliSessionMirror(): void {
    try {
      fs.rmSync(CLI_SESSION_PATH, { force: true });
    } catch (err) {
      log.warn('Failed to clear CLI session mirror:', err);
    }
  }

  /**
   * Validate whether a persisted Supabase session file appears usable.
   * We require at least one auth token entry with a parseable token payload.
   */
  private isSessionFileUsable(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return false;

      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') continue;
        if (!key.includes('auth-token') && !key.includes('supabase.auth.token') && !key.includes('session')) {
          continue;
        }
        try {
          const tokenPayload = JSON.parse(value) as { access_token?: unknown; refresh_token?: unknown };
          if (typeof tokenPayload.access_token === 'string' || typeof tokenPayload.refresh_token === 'string') {
            return true;
          }
        } catch {
          // Ignore malformed entries and keep scanning.
        }
      }
    } catch {
      // Ignore and treat as unusable.
    }
    return false;
  }

  /**
   * Best-effort migration for session storage when app-data directory names changed
   * across releases (e.g. field-theory -> fieldtheory-mac).
   *
   * This keeps users signed in after manual drag-replace installs.
   */
  private migrateLegacySessionStorageIfNeeded(targetUserDataPath: string): void {
    const targetSessionPath = path.join(targetUserDataPath, 'supabase-session.json');
    if (this.isSessionFileUsable(targetSessionPath)) {
      return;
    }

    const appDataRoot = app.getPath('appData');
    const knownAppDataNames = [
      'fieldtheory-mac',
      'field-theory',
      'Field Theory',
      'Field Theory Experimental',
      'Electron',
      'littleai-mac',
      'Oscar',
    ];

    const targetResolved = path.resolve(targetUserDataPath);
    for (const dirName of knownAppDataNames) {
      const legacyDir = path.join(appDataRoot, dirName);
      if (path.resolve(legacyDir) === targetResolved) continue;

      const legacySessionPath = path.join(legacyDir, 'supabase-session.json');
      if (!this.isSessionFileUsable(legacySessionPath)) continue;

      try {
        fs.mkdirSync(targetUserDataPath, { recursive: true });
        fs.copyFileSync(legacySessionPath, targetSessionPath);

        const targetCurrentUserPath = path.join(targetUserDataPath, 'current-user.json');
        const legacyCurrentUserPath = path.join(legacyDir, 'current-user.json');
        if (!fs.existsSync(targetCurrentUserPath) && fs.existsSync(legacyCurrentUserPath)) {
          fs.copyFileSync(legacyCurrentUserPath, targetCurrentUserPath);
        }

        log.info('Migrated auth session from legacy path:', legacySessionPath);
        return;
      } catch (err) {
        log.warn('Failed migrating session from legacy path:', legacySessionPath, err);
      }
    }
  }

  /**
   * Initialize the auth manager with Supabase credentials.
   */
  async init(supabaseUrl?: string, supabasePublishableKey?: string): Promise<void> {
    const url = supabaseUrl || process.env.VITE_SUPABASE_URL;
    const publishableKey = supabasePublishableKey
      || process.env.FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY
      || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !publishableKey) {
      log.warn('No Supabase credentials available');
      return;
    }

    const userDataPath = app.getPath('userData');
    this.migrateLegacySessionStorageIfNeeded(userDataPath);
    this.fileStorage = new FileStorage(userDataPath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = createClient(url, publishableKey, {
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
        this.emitDebug('SDK_TOKEN_REFRESHED_UNEXPECTED', {
          note: 'TOKEN_REFRESHED fired despite autoRefreshToken:false',
          hasSession: !!session,
        }, 'warn');
        this.session = session;
        this.writeCliSessionMirror(this.session);
        this.scheduleTokenRefresh();
        // Don't emit sessionChanged for token refresh - session user didn't change
      } else if (event === 'SIGNED_OUT') {
        // Clear refresh timer on logout
        this.clearRefreshTimer();

        // Check if we're in recovery cooldown to prevent infinite retry loops.
        // SDK may fire SIGNED_OUT repeatedly; we don't want to spam recovery attempts.
        const timeSinceLastFailedRecovery = Date.now() - this.lastFailedRecoveryTime;
        const inCooldown = this.lastFailedRecoveryTime > 0 && timeSinceLastFailedRecovery < AuthManager.RECOVERY_COOLDOWN_MS;

        if (inCooldown) {
          this.emitDebug('SDK_SIGNED_OUT_SKIPPED', {
            reason: 'In recovery cooldown',
            cooldownRemainingMs: AuthManager.RECOVERY_COOLDOWN_MS - timeSinceLastFailedRecovery,
          }, 'info');
          return;
        }

        if (this.intentionalSignOut) {
          this.intentionalSignOut = false;
          log.info('Intentional sign-out, skipping recovery');
          return;
        }

        this.emitDebug('SDK_SIGNED_OUT_RECEIVED', {
          hadPreviousUser: this.lastEmittedUserId !== null,
          attemptingRecovery: true,
        }, 'warn');

        // Try recovery before accepting logout (SDK may have fired spuriously)
        const recovered = await this.attemptSessionRecovery();
        if (recovered) {
          this.emitDebug('SPURIOUS_LOGOUT_RECOVERED', {
            note: 'SDK fired SIGNED_OUT but we recovered from disk',
            recoveredUser: this.session?.user?.email,
          }, 'recovery');
          this.lastFailedRecoveryTime = 0; // Reset on successful recovery
          return;
        }

        // Recovery failed - set cooldown to prevent infinite retry loop
        this.lastFailedRecoveryTime = Date.now();

        // Auth principle: never auto-logout. Even if SDK fires SIGNED_OUT and
        // recovery fails, keep the local session. User stays "logged in" locally.
        // API calls will fail silently, user can re-login from Settings when needed.
        if (this.lastEmittedUserId !== null) {
          this.emitDebug('SIGNED_OUT_IGNORED', {
            previousUserId: this.lastEmittedUserId,
            recoveryFailed: true,
            action: 'Keeping local session, not logging out',
            nextRecoveryAttemptIn: `${AuthManager.RECOVERY_COOLDOWN_MS / 60000} minutes`,
          }, 'info');
          // Don't clear session, don't emit userLoggedOut, don't clear UserDataManager.
          // User remains "logged in" from app's perspective.
        }
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && isNewSession) {
        // Only emit if this is actually a new user session
        this.session = session;
        this.writeCliSessionMirror(this.session);
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
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ data: { session: null }; error: null }>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          log.warn('getSession timeout after 5s - continuing without session');
          resolve({ data: { session: null }, error: null });
        }, 5000);
      });

      const sessionPromise = this.supabase.auth.getSession().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (timedOut) {
          log.debug('Late getSession failure after timeout:', message);
        } else {
          log.warn('getSession failed - continuing without session:', message);
        }
        return { data: { session: null }, error: null };
      });
      const { data, error } = await Promise.race([sessionPromise, timeoutPromise]);
      if (timeout) {
        clearTimeout(timeout);
      }

      if (error) {
        log.warn('Error getting session:', error.message);
      }

      if (data?.session) {
        this.session = data.session;
        this.writeCliSessionMirror(this.session);
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
        const refreshed = await this.coordinatedRefresh(rawSession.refresh_token, 'restore');
        if (!refreshed) {
          await this.restoreLocalSessionWithoutRefresh(rawSession);
        }
      } else {
        log.debug('No stored session found - user must login');
      }
    } catch (err) {
      log.warn('Failed to restore session:', err);
    }
  }

  /**
   * Keep a returning user locally signed in when the stored token cannot be
   * refreshed at startup. This preserves offline/restart behavior while later
   * API calls still depend on a server-accepted access token.
   */
  private async restoreLocalSessionWithoutRefresh(rawSession: Partial<Session>): Promise<boolean> {
    if (!rawSession.access_token || !rawSession.refresh_token || !rawSession.user?.id) {
      log.warn('Stored session was not usable for local restore');
      return false;
    }

    this.session = rawSession as Session;
    this.writeCliSessionMirror(this.session);
    this.hasEverAuthenticated = true;

    const userId = this.session.user.id;
    const shouldEmitUserChanged = userId !== this.lastEmittedUserId;
    this.lastEmittedUserId = userId;

    if (shouldEmitUserChanged && this.userDataManager) {
      await this.userDataManager.setCurrentUser(userId);
      await this.userDataManager.migrateExistingData(userId);
      this.emit('userChanged', userId);
    }

    log.warn('Using stored local session until server refresh succeeds:', this.session.user?.email);
    this.emit('sessionChanged', this.session);
    this.scheduleTokenRefresh();
    return true;
  }

  /**
   * Coordinated refresh - ensures only one refresh happens at a time.
   * Multiple callers will wait for the same refresh to complete.
   */
  private async coordinatedRefresh(refreshToken: string, source: string): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshInProgress) {
      this.emitDebug('REFRESH_WAITING', {
        source,
        note: 'Another refresh in progress, waiting...',
      }, 'info');
      await this.refreshInProgress;
      return !!this.session;
    }

    // Start a new refresh operation
    this.emitDebug('REFRESH_STARTED', {
      source,
      tokenPrefix: refreshToken.substring(0, 8) + '...',
    }, 'info');

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
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ data: { session: null }; error: { message: string } }>((resolve) => {
        refreshTimeout = setTimeout(() => {
          log.warn(`refreshSession timeout after ${REFRESH_TIMEOUT_MS}ms (${source})`);
          resolve({ data: { session: null }, error: { message: 'Refresh timeout' } });
        }, REFRESH_TIMEOUT_MS);
      });

      const { data: refreshData, error: refreshError } = await Promise.race([refreshPromise, timeoutPromise]);
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      log.debug('refreshSession returned, error:', refreshError?.message || 'none', 'hasSession:', !!refreshData?.session);

      if (refreshError) {
        if (this.isTokenRevoked(refreshError)) {
          // Belt-and-suspenders: before logging out, check if we actually have a valid session
          // This handles edge cases where refresh succeeded via another path
          this.emitDebug('REFRESH_TOKEN_ERROR', {
            source,
            error: refreshError.message,
            isRevoked: true,
            attemptingSessionCheck: true,
          }, 'warn');

          try {
            const { data: currentSession } = await this.supabase!.auth.getSession();
            if (currentSession?.session?.access_token && currentSession.session.user) {
              this.emitDebug('REFRESH_ERROR_BUT_SESSION_VALID', {
                source,
                note: 'Token error but found valid session - recovering',
                user: currentSession.session.user.email,
              }, 'recovery');
              this.session = currentSession.session;
              this.writeCliSessionMirror(this.session);
              this.clearWakeRefreshRetryTimer();
              this.scheduleTokenRefresh();
              return true; // Recovered!
            }
          } catch (checkErr) {
            log.debug('Session check failed:', checkErr);
          }

          // No valid session found - but don't log out.
          // Auth principle: never auto-logout. User stays "logged in" locally.
          // API calls will fail silently, user can re-login from Settings when needed.
          this.emitDebug('REFRESH_TOKEN_INVALID', {
            source,
            error: refreshError.message,
            action: 'Keeping local session, API calls will fail gracefully',
          }, 'warn');
          return false;
        } else {
          // Network error - will retry via scheduled refresh
          this.emitDebug('REFRESH_NETWORK_ERROR', {
            source,
            error: refreshError.message,
            willRetry: true,
          }, 'warn');
          return false;
        }
      }

      if (refreshData.session) {
        this.session = refreshData.session;
        this.writeCliSessionMirror(this.session);
        const userId = refreshData.session.user?.id ?? null;
        const expiresAt = refreshData.session.expires_at;
        const expiresInMinutes = expiresAt ? Math.round((expiresAt * 1000 - Date.now()) / 60000) : null;

        // Only emit userChanged if onAuthStateChange hasn't already done so
        const shouldEmitUserChanged = userId !== this.lastEmittedUserId;
        this.lastEmittedUserId = userId;

        // Coordinate with UserDataManager - use user ID for per-user directories
        if (shouldEmitUserChanged && userId && this.userDataManager) {
          await this.userDataManager.setCurrentUser(userId);
          await this.userDataManager.migrateExistingData(userId);
          this.emit('userChanged', userId);
        }

        this.emitDebug('REFRESH_SUCCESS', {
          source,
          user: refreshData.session.user?.email,
          expiresInMinutes,
          newUserEmitted: shouldEmitUserChanged,
        }, 'info');
        this.emit('sessionChanged', this.session);

        // Schedule next refresh
        this.clearWakeRefreshRetryTimer();
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
      if (!fs.existsSync(sessionPath)) {
        this.emitDebug('RECOVERY_NO_DISK_SESSION', {
          path: sessionPath,
        }, 'info');
        return false;
      }

      const diskData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      for (const value of Object.values(diskData)) {
        if (typeof value === 'string') {
          const parsed = JSON.parse(value);
          if (parsed?.refresh_token) {
            this.emitDebug('RECOVERY_FOUND_DISK_TOKEN', {
              tokenPrefix: parsed.refresh_token.substring(0, 8) + '...',
              user: parsed.user?.email,
            }, 'recovery');
            return await this.coordinatedRefresh(parsed.refresh_token, 'recovery');
          }
        }
      }
      this.emitDebug('RECOVERY_NO_TOKEN_IN_DISK_DATA', {
        keysFound: Object.keys(diskData),
      }, 'warn');
    } catch (err) {
      this.emitDebug('RECOVERY_FAILED', {
        error: err instanceof Error ? err.message : String(err),
      }, 'error');
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
        // Auth principle: never auto-logout. Just track failed token to avoid retrying.
        this.lastFailedToken = accessToken;
        return;
      }
    } else {
      this.lastFailedToken = null;
      this.session = data.session;
      this.writeCliSessionMirror(this.session);
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
           msg.includes('enotfound') ||
           msg.includes('enetunreach') ||
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
        this.writeCliSessionMirror(this.session);
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
        this.writeCliSessionMirror(this.session);
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
        this.writeCliSessionMirror(this.session);
        // Emit sessionChanged so listeners (like Settings) can update
        this.emit('sessionChanged', this.session);
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
    this.lastFailedRecoveryTime = 0; // Reset cooldown for fresh login
    this.clearCliSessionMirror();
  }

  async signOut(): Promise<{ error: string | null }> {
    if (!this.supabase) {
      return { error: 'Supabase not initialized' };
    }

    try {
      this.intentionalSignOut = true;
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
      this.clearCliSessionMirror();
      this.lastFailedRecoveryTime = 0; // Reset cooldown on explicit sign out
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Sign out exception:', message);
      return { error: message };
    } finally {
      this.intentionalSignOut = false;
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
      this.clearCliSessionMirror();
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

    const delayMinutes = Math.round(delay / 60000);
    this.emitDebug('REFRESH_SCHEDULED', {
      delayMinutes,
      delaySeconds: Math.round(delay / 1000),
      expiresAt: this.session.expires_at ? new Date(this.session.expires_at * 1000).toISOString() : null,
    }, 'info');

    this.refreshTimer = setTimeout(async () => {
      if (!this.session?.refresh_token) {
        this.emitDebug('REFRESH_TIMER_NO_TOKEN', {
          note: 'Timer fired but no refresh token available',
        }, 'warn');
        return;
      }

      this.emitDebug('REFRESH_TIMER_FIRED', {
        note: 'Scheduled refresh timer executing',
      }, 'info');

      try {
        const success = await this.coordinatedRefresh(this.session.refresh_token, 'scheduled');
        if (success) {
          // coordinatedRefresh will call scheduleTokenRefresh again on success
        } else {
          // Retry after delay
          this.emitDebug('REFRESH_SCHEDULING_RETRY', {
            retryInSeconds: AuthManager.RETRY_DELAY_MS / 1000,
          }, 'warn');
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

  private clearWakeRefreshRetryTimer(): void {
    if (this.wakeRefreshRetryTimer) {
      clearTimeout(this.wakeRefreshRetryTimer);
      this.wakeRefreshRetryTimer = null;
    }
  }

  private scheduleWakeRefreshRetry(): void {
    this.clearWakeRefreshRetryTimer();
    this.emitDebug('WAKE_REFRESH_RETRY_SCHEDULED', {
      retryInSeconds: AuthManager.RETRY_DELAY_MS / 1000,
    }, 'warn');

    this.wakeRefreshRetryTimer = setTimeout(() => {
      this.wakeRefreshRetryTimer = null;
      if (!this.session?.refresh_token || !this.isTokenExpiringSoon()) return;
      void this.coordinatedRefresh(this.session.refresh_token, 'wake-retry');
    }, AuthManager.RETRY_DELAY_MS);
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
      const success = await this.coordinatedRefresh(this.session.refresh_token, 'wake');
      if (!success && this.session?.refresh_token && this.isTokenExpiringSoon()) {
        this.scheduleWakeRefreshRetry();
      }
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.clearRefreshTimer();
    this.clearWakeRefreshRetryTimer();
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
