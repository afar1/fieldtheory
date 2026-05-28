import { describe, expect, it } from 'vitest';
import {
  formatTerminalCwdLabel,
  isTerminalFocusToggleSequence,
  isTerminalPanelVisibilityToggleSequence,
  mergeCodexTerminalSessions,
  nativeTerminalNavigationSequence,
  shouldFocusTerminalForRequest,
  terminalAppearanceOptions,
  terminalContrastRatio,
  terminalTheme,
  terminalViewportStyleCss,
} from '../CodexTerminalPanel';

const keyboardEvent = (input: Partial<Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>>) => ({
  altKey: false,
  code: '',
  ctrlKey: false,
  key: '',
  metaKey: false,
  shiftKey: false,
  ...input,
});

function session(input: { id: string; title?: string; cwd?: string }) {
  return {
    id: input.id,
    title: input.title ?? 'Codex 1',
    cwd: input.cwd ?? '/repo',
    engine: 'pty' as const,
    createdAt: '2026-05-25T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    restored: false,
    transcriptPath: `/tmp/${input.id}.ansi`,
    attachedContexts: [],
  };
}

describe('mergeCodexTerminalSessions', () => {
  it('replaces an existing session with the same id instead of duplicating it', () => {
    expect(mergeCodexTerminalSessions(
      [session({ id: 'one', title: 'Old title' })],
      [session({ id: 'one', title: 'New title' })],
    )).toEqual([session({ id: 'one', title: 'New title' })]);
  });

  it('keeps existing sessions and appends new ids', () => {
    expect(mergeCodexTerminalSessions(
      [session({ id: 'one' })],
      [session({ id: 'two' })],
    )).toEqual([
      session({ id: 'one' }),
      session({ id: 'two' }),
    ]);
  });
});

describe('nativeTerminalNavigationSequence', () => {
  const event = (input: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>>) => ({
    altKey: false,
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...input,
  });

  it('maps command arrows to line boundary control sequences', () => {
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowLeft', metaKey: true }))).toBe('\x01');
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowRight', metaKey: true }))).toBe('\x05');
  });

  it('maps command delete to the readline line-kill sequence', () => {
    expect(nativeTerminalNavigationSequence(event({ key: 'Backspace', metaKey: true }))).toBe('\x15');
    expect(nativeTerminalNavigationSequence(event({ key: 'Delete', metaKey: true }))).toBe('\x15');
  });

  it('maps option arrows to word navigation escape sequences', () => {
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowLeft', altKey: true }))).toBe('\x1bb');
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowRight', altKey: true }))).toBe('\x1bf');
  });

  it('leaves modified and unrelated keys alone', () => {
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowLeft', metaKey: true, shiftKey: true }))).toBeNull();
    expect(nativeTerminalNavigationSequence(event({ key: 'ArrowRight', altKey: true, ctrlKey: true }))).toBeNull();
    expect(nativeTerminalNavigationSequence(event({ key: 'a', metaKey: true }))).toBeNull();
  });
});

describe('isTerminalFocusToggleSequence', () => {
  it('does not use Command+Period for terminal focus release', () => {
    expect(isTerminalFocusToggleSequence(keyboardEvent({ key: '.', metaKey: true }))).toBe(false);
  });

  it('keeps unmodified Control+Tab for terminal focus release', () => {
    expect(isTerminalFocusToggleSequence(keyboardEvent({ key: 'Tab', ctrlKey: true }))).toBe(true);
    expect(isTerminalFocusToggleSequence(keyboardEvent({ key: 'Tab', altKey: true, ctrlKey: true }))).toBe(false);
    expect(isTerminalFocusToggleSequence(keyboardEvent({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isTerminalFocusToggleSequence(keyboardEvent({ key: 'a', ctrlKey: true }))).toBe(false);
  });
});

describe('isTerminalPanelVisibilityToggleSequence', () => {
  it('uses Command+Period for terminal panel visibility', () => {
    expect(isTerminalPanelVisibilityToggleSequence(keyboardEvent({ key: '.', metaKey: true }))).toBe(true);
    expect(isTerminalPanelVisibilityToggleSequence(keyboardEvent({ code: 'Period', key: 'Unidentified', metaKey: true }))).toBe(true);
    expect(isTerminalPanelVisibilityToggleSequence(keyboardEvent({ key: '.', metaKey: true, shiftKey: true }))).toBe(false);
  });
});

describe('shouldFocusTerminalForRequest', () => {
  it('focuses the terminal only for explicit focus requests while visible', () => {
    expect(shouldFocusTerminalForRequest({ visible: true, focusRequestKey: 1 })).toBe(true);
    expect(shouldFocusTerminalForRequest({ visible: true, focusRequestKey: 0 })).toBe(false);
    expect(shouldFocusTerminalForRequest({ visible: false, focusRequestKey: 1 })).toBe(false);
  });
});

describe('terminalTheme', () => {
  it('uses visible ANSI white values for both light and dark backgrounds', () => {
    expect(terminalTheme(false)?.background).toBe('#f7f2e8');
    expect(terminalTheme(false)?.foreground).toBe('#111827');
    expect(terminalTheme(false)?.white).toBe('#374151');
    expect(terminalTheme(false)?.brightBlack).toBe('#4b5563');
    expect(terminalTheme(false)?.brightWhite).toBe('#111827');
    expect(terminalTheme(true)?.background).toBe('#101113');
    expect(terminalTheme(true)?.white).toBe('#e8e3d8');
    expect(terminalTheme(true)?.brightWhite).toBe('#ffffff');
  });

  it('raises light terminal contrast for diff backgrounds', () => {
    expect(terminalContrastRatio(false)).toBe(4.5);
    expect(terminalContrastRatio(true)).toBe(1);
  });
});

describe('terminalAppearanceOptions', () => {
  it('keeps terminal theme and contrast together for live theme changes', () => {
    expect(terminalAppearanceOptions(true)).toEqual({
      minimumContrastRatio: terminalContrastRatio(true),
      theme: terminalTheme(true),
    });
    expect(terminalAppearanceOptions(false)).toEqual({
      minimumContrastRatio: terminalContrastRatio(false),
      theme: terminalTheme(false),
    });
  });
});

describe('terminalViewportStyleCss', () => {
  it('hides xterm viewport scrollbars against global app scrollbar styling', () => {
    const css = terminalViewportStyleCss('#f0eadf');
    expect(css).toContain('.codex-terminal-host {\n  overflow: hidden;');
    expect(css).toContain('scrollbar-width: none !important');
    expect(css).toContain('scrollbar-color: transparent transparent !important');
    expect(css).toContain('display: none !important');
    expect(css).toContain('.xterm-scrollable-element > .scrollbar');
    expect(css).toContain('width: 0 !important');
  });
});

describe('formatTerminalCwdLabel', () => {
  it('shortens user home paths for the terminal toolbar label', () => {
    expect(formatTerminalCwdLabel('/Users/afar/dev/fieldtheory')).toBe('~/dev/fieldtheory');
    expect(formatTerminalCwdLabel('/tmp/fieldtheory')).toBe('/tmp/fieldtheory');
  });
});
