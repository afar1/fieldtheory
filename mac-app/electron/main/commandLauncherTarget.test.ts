import { describe, expect, it } from 'vitest';
import {
  isDockCommandTargetBundleId,
  isExternalCommandTargetBundleId,
  isFieldTheoryCommandTargetBundleId,
  resolveCommandLauncherInvocationTarget,
} from './commandLauncherTarget';

describe('isFieldTheoryCommandTargetBundleId', () => {
  it('treats Field Theory and dev Electron as self targets', () => {
    expect(isFieldTheoryCommandTargetBundleId('com.fieldtheory.app')).toBe(true);
    expect(isFieldTheoryCommandTargetBundleId('com.github.Electron')).toBe(true);
  });

  it('keeps other Electron-based apps eligible as command paste targets', () => {
    expect(isFieldTheoryCommandTargetBundleId('com.superhuman.electron')).toBe(false);
  });
});

describe('isDockCommandTargetBundleId', () => {
  it('recognizes Dock as a non-paste target', () => {
    expect(isDockCommandTargetBundleId('com.apple.dock')).toBe(true);
    expect(isDockCommandTargetBundleId('com.apple.Safari')).toBe(false);
  });
});

describe('isExternalCommandTargetBundleId', () => {
  it('excludes Field Theory and Dock from external paste targets', () => {
    expect(isExternalCommandTargetBundleId('com.fieldtheory.app')).toBe(false);
    expect(isExternalCommandTargetBundleId('com.github.Electron')).toBe(false);
    expect(isExternalCommandTargetBundleId('com.apple.dock')).toBe(false);
  });

  it('allows ordinary external apps', () => {
    expect(isExternalCommandTargetBundleId('com.apple.TextEdit')).toBe(true);
    expect(isExternalCommandTargetBundleId('com.superhuman.electron')).toBe(true);
  });
});

describe('resolveCommandLauncherInvocationTarget', () => {
  it('uses the focused integrated terminal only when Field Theory was active', () => {
    expect(resolveCommandLauncherInvocationTarget({
      fieldTheoryActive: true,
      hasFocusedFieldTheoryTerminal: true,
      hasActiveFieldTheoryMarkdown: true,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'field-theory-terminal' });
  });

  it('ignores a stale integrated terminal when another app was active', () => {
    expect(resolveCommandLauncherInvocationTarget({
      fieldTheoryActive: false,
      hasFocusedFieldTheoryTerminal: true,
      hasActiveFieldTheoryMarkdown: false,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'external-app' });
  });

  it('keeps command text inside the active Field Theory editor when it has focus', () => {
    expect(resolveCommandLauncherInvocationTarget({
      fieldTheoryActive: true,
      hasFocusedFieldTheoryTerminal: false,
      hasActiveFieldTheoryMarkdown: true,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'field-theory-markdown' });
  });
});
