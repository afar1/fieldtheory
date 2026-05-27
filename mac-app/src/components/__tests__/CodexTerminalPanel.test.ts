import { describe, expect, it } from 'vitest';
import { mergeCodexTerminalSessions, nativeTerminalNavigationSequence, terminalTheme } from '../CodexTerminalPanel';

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

describe('terminalTheme', () => {
  it('uses visible ANSI white values for both light and dark backgrounds', () => {
    expect(terminalTheme(false)?.background).toBe('#fbf9f4');
    expect(terminalTheme(false)?.white).toBe('#4b5563');
    expect(terminalTheme(false)?.brightWhite).toBe('#111827');
    expect(terminalTheme(true)?.background).toBe('#101113');
    expect(terminalTheme(true)?.white).toBe('#e8e3d8');
    expect(terminalTheme(true)?.brightWhite).toBe('#ffffff');
  });
});
