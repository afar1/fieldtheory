import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthManager } from './authManager';
import { SharedTeamEntitlementService } from './sharedTeamEntitlementService';

interface MockEntitlementOptions {
  userId?: string | null;
  enabled?: boolean | null;
  error?: { message: string; code?: string } | null;
  throws?: Error | null;
  supabaseMissing?: boolean;
}

function makeAuthManager(options: MockEntitlementOptions = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const userId = options.userId === undefined ? 'user-1' : options.userId;
  const supabase = options.supabaseMissing ? null : {
    from(table: string) {
      calls.push({ table, method: 'from', args: [] });
      return {
        select(...args: unknown[]) {
          calls.push({ table, method: 'select', args });
          return this;
        },
        eq(...args: unknown[]) {
          calls.push({ table, method: 'eq', args });
          return this;
        },
        maybeSingle: vi.fn(async () => {
          if (options.throws) throw options.throws;
          return {
            data: options.enabled === null || options.enabled === undefined ? null : { enabled: options.enabled },
            error: options.error ?? null,
          };
        }),
      };
    },
  };

  const authManager = {
    getSupabaseClient: () => supabase,
    getSession: () => (userId ? { user: { id: userId, email: 'af@example.com', user_metadata: {} } } : null),
  } as unknown as AuthManager;

  return { authManager, calls };
}

describe('SharedTeamEntitlementService', () => {
  let tempRoot: string;
  let cachePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-team-entitlement-test-'));
    cachePath = path.join(tempRoot, 'cache.json');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('allows authenticated users with an enabled shared team beta row', async () => {
    const { authManager, calls } = makeAuthManager({ enabled: true });

    await expect(new SharedTeamEntitlementService(authManager, { cachePath }).getState()).resolves.toMatchObject({
      allowed: true,
      stale: false,
      userId: 'user-1',
    });
    expect(calls).toContainEqual({ table: 'shared_team_beta_users', method: 'eq', args: ['user_id', 'user-1'] });
  });

  it('returns not entitled for disabled or missing beta rows', async () => {
    const disabled = new SharedTeamEntitlementService(makeAuthManager({ enabled: false }).authManager, { cachePath });
    await expect(disabled.getState()).resolves.toMatchObject({ allowed: false, reason: 'not_entitled' });

    const missing = new SharedTeamEntitlementService(makeAuthManager({ enabled: null }).authManager, { cachePath });
    await expect(missing.getState()).resolves.toMatchObject({ allowed: false, reason: 'not_entitled' });
  });

  it('returns not authenticated without a session or Supabase client', async () => {
    await expect(new SharedTeamEntitlementService(makeAuthManager({ userId: null }).authManager, { cachePath }).getState())
      .resolves.toMatchObject({ allowed: false, reason: 'not_authenticated' });

    await expect(new SharedTeamEntitlementService(makeAuthManager({ supabaseMissing: true }).authManager, { cachePath }).getState())
      .resolves.toMatchObject({ allowed: false, reason: 'not_authenticated' });
  });

  it('uses same-user last-known allowed state for offline-shaped lookup failures', async () => {
    const service = new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath });
    await expect(service.getState()).resolves.toMatchObject({ allowed: true, stale: false });

    const offlineService = new SharedTeamEntitlementService(
      makeAuthManager({ throws: new Error('fetch failed because network is offline') }).authManager,
      { cachePath },
    );

    await expect(offlineService.getState()).resolves.toMatchObject({
      allowed: true,
      stale: true,
      userId: 'user-1',
    });
  });

  it('keeps synchronous cached snapshots fail-closed until an async entitlement read succeeds', async () => {
    const service = new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath });

    expect(service.getCachedState()).toMatchObject({
      allowed: false,
      reason: 'lookup_failed',
      stale: false,
      userId: 'user-1',
    });

    await expect(service.getState()).resolves.toMatchObject({ allowed: true, stale: false, userId: 'user-1' });
    expect(service.getCachedState()).toMatchObject({ allowed: true, stale: false, userId: 'user-1' });
  });

  it('restores cached snapshots after an async offline lookup uses same-user allowed cache', async () => {
    await expect(new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath }).getState())
      .resolves.toMatchObject({ allowed: true, stale: false, userId: 'user-1' });

    const offlineService = new SharedTeamEntitlementService(
      makeAuthManager({ throws: new Error('network offline') }).authManager,
      { cachePath },
    );

    expect(offlineService.getCachedState()).toMatchObject({
      allowed: false,
      reason: 'lookup_failed',
      stale: false,
      userId: 'user-1',
    });
    await expect(offlineService.getState()).resolves.toMatchObject({ allowed: true, stale: true, userId: 'user-1' });
    expect(offlineService.getCachedState()).toMatchObject({ allowed: true, stale: true, userId: 'user-1' });
  });

  it('does not use another user cache entry after sign-in changes', async () => {
    const service = new SharedTeamEntitlementService(makeAuthManager({ enabled: true, userId: 'user-1' }).authManager, { cachePath });
    await expect(service.getState()).resolves.toMatchObject({ allowed: true, userId: 'user-1' });

    const offlineService = new SharedTeamEntitlementService(
      makeAuthManager({ throws: new Error('network offline'), userId: 'user-2' }).authManager,
      { cachePath },
    );

    await expect(offlineService.getState()).resolves.toMatchObject({
      allowed: false,
      reason: 'lookup_failed',
      stale: false,
      userId: 'user-2',
    });
  });

  it('clears last-known allowed state after a successful online disabled or missing row read', async () => {
    const service = new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath });
    await expect(service.getState()).resolves.toMatchObject({ allowed: true });

    const disabled = new SharedTeamEntitlementService(makeAuthManager({ enabled: false }).authManager, { cachePath });
    await expect(disabled.getState()).resolves.toMatchObject({ allowed: false, reason: 'not_entitled' });

    const offline = new SharedTeamEntitlementService(
      makeAuthManager({ throws: new Error('network offline') }).authManager,
      { cachePath },
    );
    await expect(offline.getState()).resolves.toMatchObject({ allowed: false, reason: 'lookup_failed' });
  });

  it('treats permission and schema contract errors as not entitled', async () => {
    await expect(new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath }).getState())
      .resolves.toMatchObject({ allowed: true });

    const permission = new SharedTeamEntitlementService(
      makeAuthManager({ error: { message: 'permission denied for table shared_team_beta_users', code: '42501' } }).authManager,
      { cachePath },
    );
    await expect(permission.getState()).resolves.toMatchObject({ allowed: false, reason: 'not_entitled' });

    const offline = new SharedTeamEntitlementService(
      makeAuthManager({ throws: new Error('network offline') }).authManager,
      { cachePath },
    );
    await expect(offline.getState()).resolves.toMatchObject({ allowed: false, reason: 'lookup_failed' });

    await expect(new SharedTeamEntitlementService(makeAuthManager({ enabled: true }).authManager, { cachePath }).getState())
      .resolves.toMatchObject({ allowed: true });
    const missingTable = new SharedTeamEntitlementService(
      makeAuthManager({ error: { message: 'relation "shared_team_beta_users" does not exist', code: '42P01' } }).authManager,
      { cachePath },
    );
    await expect(missingTable.getState()).resolves.toMatchObject({ allowed: false, reason: 'not_entitled' });
  });
});
