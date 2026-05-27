import { describe, expect, it } from 'vitest';
import {
  FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV,
  autoUpdaterAllowsPrereleaseForBuildChannel,
  autoUpdaterAuthTokenForBuildChannel,
  autoUpdaterFeedOptionsForBuildChannel,
  autoUpdaterReleaseRepoForBuildChannel,
  isAutoUpdaterEnabledForBuildChannel,
  normalizeGitHubToken,
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
    expect(releaseRepoForBuildChannel('experimental')).toBe('oscar');
  });

  it('enables the auto-updater for packaged release channels', () => {
    expect(isAutoUpdaterEnabledForBuildChannel('production')).toBe(true);
    expect(isAutoUpdaterEnabledForBuildChannel('experimental')).toBe(true);
  });

  it('exposes auto-updater feeds by release channel', () => {
    expect(autoUpdaterReleaseRepoForBuildChannel('production')).toBe('field-releases');
    expect(autoUpdaterReleaseRepoForBuildChannel('experimental')).toBe('oscar');
  });

  it('builds a public production auto-updater feed', () => {
    expect(autoUpdaterFeedOptionsForBuildChannel('production')).toEqual({
      provider: 'github',
      owner: 'afar1',
      repo: 'field-releases',
    });
  });

  it('builds a private experimental auto-updater feed when a token is available', () => {
    expect(autoUpdaterFeedOptionsForBuildChannel('experimental', 'abc123')).toEqual({
      provider: 'github',
      owner: 'afar1',
      repo: 'oscar',
      private: true,
      token: 'abc123',
    });
  });

  it('allows prereleases only for experimental builds', () => {
    expect(autoUpdaterAllowsPrereleaseForBuildChannel('production')).toBe(false);
    expect(autoUpdaterAllowsPrereleaseForBuildChannel('experimental')).toBe(true);
  });

  it('reads the experimental update token from the channel-specific env var', () => {
    expect(autoUpdaterAuthTokenForBuildChannel('experimental', {
      [FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV]: ' token abc123 ',
    })).toBe('abc123');
  });

  it('does not use the experimental update token for production builds', () => {
    expect(autoUpdaterAuthTokenForBuildChannel('production', {
      [FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV]: 'abc123',
    })).toBeNull();
  });

  it('treats blank experimental update tokens as unavailable', () => {
    expect(autoUpdaterAuthTokenForBuildChannel('experimental', {
      [FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV]: '   ',
    })).toBeNull();
  });

  it('normalizes common GitHub authorization header prefixes', () => {
    expect(normalizeGitHubToken('token abc123')).toBe('abc123');
    expect(normalizeGitHubToken('Bearer abc123')).toBe('abc123');
    expect(normalizeGitHubToken('abc123')).toBe('abc123');
  });
});
