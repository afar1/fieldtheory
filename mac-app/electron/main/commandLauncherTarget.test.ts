import { describe, expect, it } from 'vitest';
import {
  isDockCommandTargetBundleId,
  isExternalCommandTargetBundleId,
  isFieldTheoryCommandTargetBundleId,
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
