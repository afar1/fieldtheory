import { describe, expect, it } from 'vitest';
import { isFieldTheoryInternalSyncEnvEnabled, resolveFieldTheorySyncStatus } from './releaseSyncPolicy';

describe('release sync policy', () => {
  it('keeps Field Theory sync disabled by default', () => {
    expect(resolveFieldTheorySyncStatus({
      localEnabled: false,
      authenticated: true,
    })).toMatchObject({
      enabled: false,
      reason: 'local_disabled',
      serverEnforced: false,
    });
  });

  it('requires authentication after the hidden local switch is enabled', () => {
    expect(resolveFieldTheorySyncStatus({
      localEnabled: true,
      authenticated: false,
    })).toMatchObject({
      enabled: false,
      reason: 'not_authenticated',
    });
  });

  it('allows sync attempts only when local switch and auth are both present', () => {
    expect(resolveFieldTheorySyncStatus({
      localEnabled: true,
      authenticated: true,
    })).toMatchObject({
      enabled: true,
      reason: 'enabled',
    });
  });

  it('supports an explicit internal sync env override', () => {
    expect(isFieldTheoryInternalSyncEnvEnabled({ FIELD_THEORY_INTERNAL_SYNC_ENABLED: 'true' })).toBe(true);
    expect(isFieldTheoryInternalSyncEnvEnabled({ FIELD_THEORY_INTERNAL_SYNC: '1' })).toBe(true);
    expect(isFieldTheoryInternalSyncEnvEnabled({ FIELD_THEORY_INTERNAL_SYNC_ENABLED: 'false' })).toBe(false);
  });
});
