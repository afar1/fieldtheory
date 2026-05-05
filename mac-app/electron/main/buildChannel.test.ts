import { describe, expect, it } from 'vitest';
import {
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

  it('uses a separate release repo for experimental updates', () => {
    expect(releaseRepoForBuildChannel('production')).toBe('field-releases');
    expect(releaseRepoForBuildChannel('experimental')).toBe('field-releases-experimental');
  });
});
