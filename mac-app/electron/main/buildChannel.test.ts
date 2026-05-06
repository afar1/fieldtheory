import { describe, expect, it } from 'vitest';
import {
  autoUpdaterReleaseRepoForBuildChannel,
  isAutoUpdaterEnabledForBuildChannel,
  releaseRepoForBuildChannel,
  resolveFieldTheoryBuildChannel,
} from './buildChannel';

describe('buildChannel', () => {
  it('defaults to production', () => {
    expect(resolveFieldTheoryBuildChannel({ env: {} })).toBe('production');
  });

  it('uses FIELD_THEORY_BUILD_CHANNEL when present', () => {
    expect(resolveFieldTheoryBuildChannel({
      env: { FIELD_THEORY_BUILD_CHANNEL: 'experimental' },
    })).toBe('experimental');
  });

  it('keeps the legacy EXPERIMENTAL env opt-in for dev runs', () => {
    expect(resolveFieldTheoryBuildChannel({
      env: { EXPERIMENTAL: 'true' },
    })).toBe('experimental');
  });

  it('uses packaged build metadata when env is absent', () => {
    expect(resolveFieldTheoryBuildChannel({
      env: {},
      metadataChannel: 'experimental',
    })).toBe('experimental');
  });

  it('detects packaged experimental builds by app name', () => {
    expect(resolveFieldTheoryBuildChannel({
      env: {},
      appName: 'Field Theory Experimental',
    })).toBe('experimental');
  });

  it('keeps the release repo mapping separate by channel', () => {
    expect(releaseRepoForBuildChannel('production')).toBe('field-releases');
    expect(releaseRepoForBuildChannel('experimental')).toBe('field-releases-experimental');
  });

  it('only enables the auto-updater for production builds', () => {
    expect(isAutoUpdaterEnabledForBuildChannel('production')).toBe(true);
    expect(isAutoUpdaterEnabledForBuildChannel('experimental')).toBe(false);
  });

  it('does not expose an auto-updater feed for experimental builds', () => {
    expect(autoUpdaterReleaseRepoForBuildChannel('production')).toBe('field-releases');
    expect(autoUpdaterReleaseRepoForBuildChannel('experimental')).toBeNull();
  });
});
