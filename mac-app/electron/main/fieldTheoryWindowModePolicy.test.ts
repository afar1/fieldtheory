import { describe, expect, it } from 'vitest';
import {
  shouldHideFieldTheoryWindowsForAlfred,
  shouldRestoreFieldTheoryFocusAfterFloatingRecording,
  shouldToggleCloseFieldTheoryFromDynamicIsland,
} from './fieldTheoryWindowModePolicy';

describe('shouldHideFieldTheoryWindowsForAlfred', () => {
  it('does not hide normal app-mode Field Theory windows', () => {
    expect(shouldHideFieldTheoryWindowsForAlfred('app')).toBe(false);
  });

  it('keeps panel-mode Alfred hiding behavior', () => {
    expect(shouldHideFieldTheoryWindowsForAlfred('panel')).toBe(true);
  });
});

describe('shouldToggleCloseFieldTheoryFromDynamicIsland', () => {
  it('does not toggle-close normal app-mode Field Theory windows', () => {
    expect(shouldToggleCloseFieldTheoryFromDynamicIsland('app')).toBe(false);
  });

  it('keeps panel-mode Dynamic Island toggle-close behavior', () => {
    expect(shouldToggleCloseFieldTheoryFromDynamicIsland('panel')).toBe(true);
  });
});

describe('shouldRestoreFieldTheoryFocusAfterFloatingRecording', () => {
  it('preserves focus when floating recording starts from a focused app-mode window', () => {
    expect(shouldRestoreFieldTheoryFocusAfterFloatingRecording(
      'app',
      'floating',
      'recording',
      true,
      true
    )).toBe(true);
  });

  it('does not pull Field Theory forward when recording starts outside the app window', () => {
    expect(shouldRestoreFieldTheoryFocusAfterFloatingRecording(
      'app',
      'floating',
      'recording',
      true,
      false
    )).toBe(false);
  });

  it('keeps panel-mode floating recording behavior unchanged', () => {
    expect(shouldRestoreFieldTheoryFocusAfterFloatingRecording(
      'panel',
      'floating',
      'recording',
      true,
      true
    )).toBe(false);
  });

  it('only applies to the floating recording indicator', () => {
    expect(shouldRestoreFieldTheoryFocusAfterFloatingRecording(
      'app',
      'notch',
      'recording',
      true,
      true
    )).toBe(false);
  });
});
