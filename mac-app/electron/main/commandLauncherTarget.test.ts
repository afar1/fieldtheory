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
      focusedFieldTheoryTerminalSessionId: 'terminal-1',
      hasActiveFieldTheoryMarkdown: true,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'field-theory-terminal', sessionId: 'terminal-1' });
  });

  it('ignores a stale integrated terminal when another app was active', () => {
    expect(resolveCommandLauncherInvocationTarget({
      fieldTheoryActive: false,
      hasFocusedFieldTheoryTerminal: true,
      focusedFieldTheoryTerminalSessionId: 'terminal-1',
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

  it('uses a captured Field Theory terminal origin even if markdown is active later', () => {
    expect(resolveCommandLauncherInvocationTarget({
      launchOrigin: { kind: 'field-theory', surface: { kind: 'terminal', sessionId: 'terminal-at-open' } },
      fieldTheoryActive: true,
      hasFocusedFieldTheoryTerminal: false,
      hasActiveFieldTheoryMarkdown: true,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'field-theory-terminal', sessionId: 'terminal-at-open' });
  });

  it('uses a captured Field Theory markdown origin instead of a stale external target', () => {
    expect(resolveCommandLauncherInvocationTarget({
      launchOrigin: { kind: 'field-theory', surface: { kind: 'markdown' } },
      fieldTheoryActive: true,
      hasFocusedFieldTheoryTerminal: false,
      hasActiveFieldTheoryMarkdown: false,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'field-theory-markdown' });
  });

  it('does not fall back to an external target when the captured Field Theory origin has no input surface', () => {
    expect(resolveCommandLauncherInvocationTarget({
      launchOrigin: { kind: 'field-theory', surface: { kind: 'none' } },
      fieldTheoryActive: true,
      hasFocusedFieldTheoryTerminal: false,
      hasActiveFieldTheoryMarkdown: true,
      hasExternalTargetApp: true,
    })).toEqual({ kind: 'none' });
  });
});
