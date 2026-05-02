import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountStatusManager } from './accountStatusManager';

function makeManager(): AccountStatusManager {
  const manager = new AccountStatusManager();
  manager.init('https://example.supabase.co', () => ({
    access_token: 'token',
    user: { email: 'user@example.com' },
  }));
  return manager;
}

function stubUsageResponse(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })));
}

describe('AccountStatusManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps local writes available when no session is present', async () => {
    const manager = new AccountStatusManager();
    manager.init('https://example.supabase.co', () => null);

    const status = await manager.checkNow();

    expect(status).toMatchObject({
      state: 'needs_login',
      capabilityMode: 'writable',
    });
  });

  it('maps active trial usage to writable trial status', async () => {
    stubUsageResponse({
      state: 'trial',
      app_access_mode: 'active',
      trialEndsAt: '2026-05-01T00:00:00.000Z',
    });

    const status = await makeManager().checkNow();

    expect(status).toMatchObject({
      state: 'active',
      capabilityMode: 'writable',
      tier: 'trial',
      email: 'user@example.com',
      trialEndsAt: '2026-05-01T00:00:00.000Z',
    });
  });

  it('maps admin read-only override to read-only status', async () => {
    stubUsageResponse({
      state: 'pro',
      app_access_mode: 'read_only',
    });

    const status = await makeManager().checkNow();

    expect(status).toMatchObject({
      state: 'read_only',
      capabilityMode: 'read_only',
      reason: 'admin_override',
      email: 'user@example.com',
    });
  });

  it('keeps expired trial usage writable for local-first release access', async () => {
    stubUsageResponse({
      state: 'expired',
      app_access_mode: 'active',
    });

    const status = await makeManager().checkNow();

    expect(status).toMatchObject({
      state: 'active',
      capabilityMode: 'writable',
      tier: 'trial',
      email: 'user@example.com',
    });
  });

  it('preserves previous writable capability when a later account check is offline', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: 'expired', app_access_mode: 'active' }),
      })
      .mockRejectedValueOnce(new Error('network timeout'));
    vi.stubGlobal('fetch', fetch);

    const manager = makeManager();
    await manager.checkNow();
    const status = await manager.checkNow();

    expect(status).toMatchObject({
      state: 'offline',
      capabilityMode: 'writable',
      lastKnownState: 'trial',
    });
  });
});
