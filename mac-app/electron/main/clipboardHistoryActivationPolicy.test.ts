import { describe, expect, it } from 'vitest';
import { getClipboardHistoryActivationPreflightSkipReason } from './clipboardHistoryActivationPolicy';

describe('getClipboardHistoryActivationPreflightSkipReason', () => {
  it('skips app activation while a command launcher invocation is in flight even after the launcher hides', () => {
    expect(getClipboardHistoryActivationPreflightSkipReason({
      onboardingComplete: true,
      commandLauncherExternalInvocationSuppressed: true,
      commandLauncherShowingOrVisible: false,
    })).toBe('command-launcher-external-invocation');
  });

  it('continues to skip activation while the command launcher is visible', () => {
    expect(getClipboardHistoryActivationPreflightSkipReason({
      onboardingComplete: true,
      commandLauncherExternalInvocationSuppressed: false,
      commandLauncherShowingOrVisible: true,
    })).toBe('command-launcher-visible');
  });

  it('lets normal activation continue once launcher guards are clear', () => {
    expect(getClipboardHistoryActivationPreflightSkipReason({
      onboardingComplete: true,
      commandLauncherExternalInvocationSuppressed: false,
      commandLauncherShowingOrVisible: false,
    })).toBeNull();
  });
});
