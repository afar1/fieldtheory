import { describe, expect, it } from 'vitest';
import { isFieldTheoryCommandTargetBundleId } from './commandLauncherTarget';
import { resolveFieldTheorySelectionText, shouldRejectFieldTheoryPathFallback } from './globalImproveSelection';

const isFieldTheoryTarget = isFieldTheoryCommandTargetBundleId;

describe('shouldRejectFieldTheoryPathFallback', () => {
  it('rejects the active Field Theory document path copied by the no-selection fallback', () => {
    expect(shouldRejectFieldTheoryPathFallback({
      copiedText: '/Users/afar/Library/Notes/Example.md',
      targetApp: { bundleId: 'com.fieldtheory.app', name: 'Field Theory' },
      activeFilePath: '/Users/afar/Library/Notes/Example.md',
      isFieldTheoryTarget,
    })).toBe(true);
  });

  it('keeps real selected text from Field Theory', () => {
    expect(shouldRejectFieldTheoryPathFallback({
      copiedText: 'Please improve this sentence.',
      targetApp: { bundleId: 'com.fieldtheory.app', name: 'Field Theory' },
      activeFilePath: '/Users/afar/Library/Notes/Example.md',
      isFieldTheoryTarget,
    })).toBe(false);
  });

  it('rejects the active document path for experimental and dev Field Theory builds', () => {
    for (const targetApp of [
      { bundleId: 'com.fieldtheory.experimental', name: 'Field Theory Experimental' },
      { bundleId: 'com.github.Electron', name: 'Field Theory' },
    ]) {
      expect(shouldRejectFieldTheoryPathFallback({
        copiedText: '/Users/afar/Library/Notes/Example.md',
        targetApp,
        activeFilePath: '/Users/afar/Library/Notes/Example.md',
        isFieldTheoryTarget,
      })).toBe(true);
    }
  });

  it('does not reject matching text copied from another app', () => {
    expect(shouldRejectFieldTheoryPathFallback({
      copiedText: '/Users/afar/Library/Notes/Example.md',
      targetApp: { bundleId: 'com.apple.TextEdit', name: 'TextEdit' },
      activeFilePath: '/Users/afar/Library/Notes/Example.md',
      isFieldTheoryTarget,
    })).toBe(false);
  });
});

describe('resolveFieldTheorySelectionText', () => {
  it('uses the active Field Theory selection context', () => {
    expect(resolveFieldTheorySelectionText({
      targetApp: { bundleId: 'com.fieldtheory.app', name: 'Field Theory' },
      activeContext: { selectionText: '  Improve this sentence.  ' },
      isFieldTheoryTarget,
    })).toBe('Improve this sentence.');
  });

  it('uses the active Field Theory selection context for experimental and dev builds', () => {
    for (const targetApp of [
      { bundleId: 'com.fieldtheory.experimental', name: 'Field Theory Experimental' },
      { bundleId: 'com.github.Electron', name: 'Field Theory' },
    ]) {
      expect(resolveFieldTheorySelectionText({
        targetApp,
        activeContext: { selectionText: '  Improve this sentence.  ' },
        isFieldTheoryTarget,
      })).toBe('Improve this sentence.');
    }
  });

  it('returns empty text for Field Theory when there is no selection', () => {
    expect(resolveFieldTheorySelectionText({
      targetApp: { bundleId: 'com.fieldtheory.app', name: 'Field Theory' },
      activeContext: {},
      isFieldTheoryTarget,
    })).toBe('');
  });

  it('does not handle non-Field Theory targets', () => {
    expect(resolveFieldTheorySelectionText({
      targetApp: { bundleId: 'com.apple.TextEdit', name: 'TextEdit' },
      activeContext: { selectionText: 'Improve this sentence.' },
      isFieldTheoryTarget,
    })).toBeNull();
  });
});
