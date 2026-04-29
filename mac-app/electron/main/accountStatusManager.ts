import { EventEmitter } from 'events';
import { createLogger } from './logger';

const log = createLogger('AccountStatus');

export type AccountCapabilityMode = 'writable' | 'read_only';

export type AccountStatus =
  | { state: 'checking'; capabilityMode: AccountCapabilityMode }
  | {
      state: 'active';
      capabilityMode: 'writable';
      tier: 'pro' | 'trial';
      email?: string;
      checkedAt: string;
      trialEndsAt?: string | null;
    }
  | {
      state: 'offline';
      capabilityMode: AccountCapabilityMode;
      lastKnownState: 'active' | 'trial' | 'read_only';
      checkedAt?: string | null;
    }
  | {
      state: 'read_only';
      capabilityMode: 'read_only';
      reason: 'trial_expired' | 'admin_override' | 'payment_required';
      email?: string;
      checkedAt: string;
    }
  | {
      state: 'needs_login';
      capabilityMode: 'read_only';
      email?: string;
    }
  | {
      state: 'disabled';
      capabilityMode: 'read_only';
      reason: string;
    };

type UsageResponse = {
  state?: 'pro' | 'trial' | 'expired';
  app_access_mode?: 'active' | 'read_only' | 'disabled';
  trialEndsAt?: string | null;
};

function lastKnownStateFor(status: AccountStatus): 'active' | 'trial' | 'read_only' {
  if (status.state === 'active') return status.tier === 'trial' ? 'trial' : 'active';
  if (status.state === 'read_only' || status.state === 'disabled') return 'read_only';
  if (status.state === 'offline') return status.lastKnownState;
  return 'active';
}

function checkedAtFor(status: AccountStatus): string | null {
  return 'checkedAt' in status ? status.checkedAt ?? null : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(error);
}

function isNetworkError(error: unknown): boolean {
  const text = getErrorMessage(error).toLowerCase();
  return text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('enetunreach');
}

export class AccountStatusManager extends EventEmitter {
  private status: AccountStatus = { state: 'checking', capabilityMode: 'writable' };
  private supabaseUrl = '';
  private getSession: (() => { access_token: string; user?: { email?: string | null } } | null) | null = null;

  init(supabaseUrl: string, getSession: () => { access_token: string; user?: { email?: string | null } } | null): void {
    this.supabaseUrl = supabaseUrl;
    this.getSession = getSession;
  }

  getStatus(): AccountStatus {
    return this.status;
  }

  getCapabilityMode(): AccountCapabilityMode {
    return this.status.capabilityMode;
  }

  setNeedsLogin(email?: string): void {
    this.setStatus({ state: 'needs_login', capabilityMode: 'read_only', email });
  }

  async checkNow(): Promise<AccountStatus> {
    const session = this.getSession?.();
    const previousStatus = this.status;

    if (!session?.access_token) {
      this.setNeedsLogin(session?.user?.email ?? undefined);
      return this.status;
    }

    this.setStatus({ state: 'checking', capabilityMode: previousStatus.capabilityMode });

    try {
      const response = await fetch(`${this.supabaseUrl}/functions/v1/get-usage`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.setNeedsLogin(session.user?.email ?? undefined);
          return this.status;
        }
        throw new Error(`get-usage failed with status ${response.status}`);
      }

      const data = await response.json() as UsageResponse;
      const checkedAt = new Date().toISOString();

      if (data.app_access_mode === 'disabled') {
        this.setStatus({ state: 'disabled', capabilityMode: 'read_only', reason: 'account_disabled' });
        return this.status;
      }

      if (data.app_access_mode === 'read_only') {
        this.setStatus({
          state: 'read_only',
          capabilityMode: 'read_only',
          reason: 'admin_override',
          email: session.user?.email ?? undefined,
          checkedAt,
        });
        return this.status;
      }

      if (data.state === 'expired') {
        this.setStatus({
          state: 'read_only',
          capabilityMode: 'read_only',
          reason: 'trial_expired',
          email: session.user?.email ?? undefined,
          checkedAt,
        });
        return this.status;
      }

      this.setStatus({
        state: 'active',
        capabilityMode: 'writable',
        tier: data.state === 'trial' ? 'trial' : 'pro',
        email: session.user?.email ?? undefined,
        checkedAt,
        trialEndsAt: data.trialEndsAt ?? null,
      });
      return this.status;
    } catch (error) {
      if (isNetworkError(error)) {
        this.setStatus({
          state: 'offline',
          capabilityMode: previousStatus.capabilityMode,
          lastKnownState: lastKnownStateFor(previousStatus),
          checkedAt: checkedAtFor(previousStatus),
        });
        return this.status;
      }

      log.error('Account check failed:', getErrorMessage(error));
      return this.status;
    }
  }

  private setStatus(nextStatus: AccountStatus): void {
    this.status = nextStatus;
    this.emit('statusChanged', nextStatus);
  }
}
