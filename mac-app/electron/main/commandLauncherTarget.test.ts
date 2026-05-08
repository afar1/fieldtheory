import { describe, expect, it } from 'vitest';
import { isFieldTheoryCommandTargetBundleId } from './commandLauncherTarget';

describe('isFieldTheoryCommandTargetBundleId', () => {
  it('treats Field Theory and dev Electron as self targets', () => {
    expect(isFieldTheoryCommandTargetBundleId('com.fieldtheory.app')).toBe(true);
    expect(isFieldTheoryCommandTargetBundleId('com.github.Electron')).toBe(true);
  });

  it('keeps other Electron-based apps eligible as command paste targets', () => {
    expect(isFieldTheoryCommandTargetBundleId('com.superhuman.electron')).toBe(false);
  });
});
