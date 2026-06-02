import { describe, expect, it } from 'vitest';
import { browserLibraryTargetFromProtocolUrl } from './fieldTheoryProtocolTarget';

function target(url: string) {
  return browserLibraryTargetFromProtocolUrl(new URL(url));
}

describe('browserLibraryTargetFromProtocolUrl', () => {
  it('parses browser-library JSON target links', () => {
    const encodedTarget = encodeURIComponent(JSON.stringify({
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
      contentMode: 'markdown',
      selectionStart: 5,
      selectionEnd: 12,
      focusChrome: true,
    }));

    expect(target(`fieldtheory://browser-library/open?target=${encodedTarget}`)).toEqual({
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
      contentMode: 'markdown',
      selectionStart: 5,
      selectionEnd: 12,
      focusChrome: true,
    });
  });

  it('parses flat browser-library target params', () => {
    expect(target('fieldtheory://browser-library/open?kind=wiki&path=scratchpad%2FPlan.md&contentMode=rendered&sidebarCollapsed=1')).toEqual({
      kind: 'wiki',
      path: 'scratchpad/Plan.md',
      contentMode: 'rendered',
      sidebarCollapsed: true,
    });
  });

  it('parses direct included surface links', () => {
    expect(target('fieldtheory://bookmarks/open')).toEqual({ kind: 'bookmarks', path: 'bookmarks' });
    expect(target('fieldtheory://commands/open')).toEqual({ kind: 'commands', path: 'commands' });
    expect(target('fieldtheory://ember/open?focusChrome=true')).toEqual({ kind: 'ember', path: 'ember', focusChrome: true });
  });

  it('ignores older protocol URLs handled by native code elsewhere', () => {
    expect(target('fieldtheory://wiki/open?file=/tmp/Plan.md')).toBeNull();
    expect(target('fieldtheory://librarian/import?file=/tmp/Reading.md')).toBeNull();
  });

  it('rejects targets outside the Browser Library included surface', () => {
    const encodedTarget = encodeURIComponent(JSON.stringify({ kind: 'clipboard' }));
    expect(target(`fieldtheory://browser-library/open?target=${encodedTarget}`)).toBeNull();
    expect(target('fieldtheory://browser-library/open?kind=clipboard')).toBeNull();
  });
});
