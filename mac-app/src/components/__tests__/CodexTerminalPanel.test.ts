import { describe, expect, it } from 'vitest';
import { mergeCodexTerminalCwdHistory, mergeCodexTerminalSessions, nativeGhosttyKeyInputForEvent, rectToNativeGhosttyFrame } from '../CodexTerminalPanel';

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

describe('mergeCodexTerminalCwdHistory', () => {
  it('deduplicates cwd entries with newest incoming paths first', () => {
    expect(mergeCodexTerminalCwdHistory(
      ['/repo/old', '/repo/shared'],
      ['/repo/new', '/repo/shared'],
    )).toEqual(['/repo/new', '/repo/shared', '/repo/old']);
  });

  it('drops blank cwd entries', () => {
    expect(mergeCodexTerminalCwdHistory(['/repo'], [' ', '/other'])).toEqual(['/other', '/repo']);
  });
});

describe('rectToNativeGhosttyFrame', () => {
  it('converts DOM top-left coordinates to AppKit bottom-left coordinates', () => {
    expect(rectToNativeGhosttyFrame({
      left: 10.2,
      bottom: 520.6,
      width: 800.4,
      height: 300.2,
    }, 900)).toEqual({
      x: 10,
      y: 379,
      width: 800,
      height: 300,
    });
  });
});

function keyEvent(input: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'repeat'>> = {}) {
  return {
    key: input.key ?? 'a',
    code: input.code ?? 'KeyA',
    metaKey: input.metaKey ?? false,
    altKey: input.altKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    shiftKey: input.shiftKey ?? false,
    repeat: input.repeat ?? false,
    getModifierState: () => false,
  };
}

describe('nativeGhosttyKeyInputForEvent', () => {
  it('maps common terminal keys to Ghostty key events instead of byte sequences', () => {
    expect(nativeGhosttyKeyInputForEvent('session-1', keyEvent({ key: 'Enter', code: 'Enter' }))).toMatchObject({
      id: 'session-1',
      action: 'press',
      keyCode: 0x24,
      text: '',
    });
    expect(nativeGhosttyKeyInputForEvent('session-1', keyEvent({ key: 'Backspace', code: 'Backspace' }))).toMatchObject({
      keyCode: 0x33,
      text: '',
    });
    expect(nativeGhosttyKeyInputForEvent('session-1', keyEvent({ key: 'ArrowUp', code: 'ArrowUp' }))).toMatchObject({
      keyCode: 0x7E,
      text: '',
    });
  });

  it('preserves ctrl and alt terminal modifiers while leaving command shortcuts with the app', () => {
    expect(nativeGhosttyKeyInputForEvent('session-1', keyEvent({ key: 'c', code: 'KeyC', ctrlKey: true }))).toMatchObject({
      keyCode: 0x08,
      text: 'c',
      ctrl: true,
    });
    expect(nativeGhosttyKeyInputForEvent('session-1', keyEvent({ key: 't', code: 'KeyT', metaKey: true }))).toBeNull();
  });
});
