import { describe, expect, it, vi } from 'vitest';
import {
  formatTerminalCwdLabel,
  estimateCodexTerminalSize,
  getTerminalResizeDimension,
  getTerminalDataAfterInitialReplayEcho,
  getUnreplayedInitialData,
  isTerminalFocusToggleSequence,
  isTerminalPanelVisibilityToggleSequence,
  isTerminalPasteSequence,
  mergeCodexTerminalSessions,
  nativeTerminalNavigationSequence,
  resolveCodexTerminalDockSide,
  shouldSendBackendResize,
  shouldFocusTerminalForRequest,
  shouldUseCompactRightDockToolbar,
  getTerminalLayoutRefitDelays,
  getTerminalTopExtension,
  pasteClipboardIntoCodexTerminal,
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
    title: input.title ?? 'Terminal 1',
    cwd: input.cwd ?? '/repo',
    engine: 'pty' as const,
    createdAt: '2026-05-25T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    restored: false,
    modelRunActive: false,
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

describe('isTerminalPasteSequence', () => {
  it('captures plain Command+V for xterm paste', () => {
    expect(isTerminalPasteSequence(keyboardEvent({ key: 'v', metaKey: true }))).toBe(true);
    expect(isTerminalPasteSequence(keyboardEvent({ key: 'V', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isTerminalPasteSequence(keyboardEvent({ key: 'v', metaKey: true, altKey: true }))).toBe(false);
    expect(isTerminalPasteSequence(keyboardEvent({ key: 'v', metaKey: true, ctrlKey: true }))).toBe(false);
  });
});

describe('pasteClipboardIntoCodexTerminal', () => {
  it('writes normalized terminal paste text directly to the PTY session', async () => {
    const api = {
      readTerminalPasteText: vi.fn(async () => '/tmp/Screenshot.png'),
      input: vi.fn(async () => true),
    };

    await expect(pasteClipboardIntoCodexTerminal(api, 'session-1')).resolves.toBe(true);

    expect(api.readTerminalPasteText).toHaveBeenCalledTimes(1);
    expect(api.input).toHaveBeenCalledWith('session-1', '/tmp/Screenshot.png');
  });

  it('does nothing when the terminal paste resolver has no text', async () => {
    const api = {
      readTerminalPasteText: vi.fn(async () => ''),
      input: vi.fn(async () => true),
    };

    await expect(pasteClipboardIntoCodexTerminal(api, 'session-1')).resolves.toBe(false);

    expect(api.input).not.toHaveBeenCalled();
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

describe('getTerminalLayoutRefitDelays', () => {
  it('schedules delayed refits only while the terminal is visible', () => {
    expect(getTerminalLayoutRefitDelays({ visible: true })).toEqual([50, 180]);
    expect(getTerminalLayoutRefitDelays({ visible: false })).toEqual([]);
  });
});

describe('shouldSendBackendResize', () => {
  it('does not resize the backend while the initial terminal buffer is replaying', () => {
    expect(shouldSendBackendResize({ replayingInitialBuffer: true, now: 1000, suppressUntil: 0 })).toBe(false);
  });

  it('waits until the startup resize suppression window has expired', () => {
    expect(shouldSendBackendResize({ replayingInitialBuffer: false, now: 1000, suppressUntil: 1200 })).toBe(false);
    expect(shouldSendBackendResize({ replayingInitialBuffer: false, now: 1200, suppressUntil: 1200 })).toBe(true);
  });
});

describe('getUnreplayedInitialData', () => {
  it('returns queued chunks that are not already included in the replay buffer', () => {
    expect(getUnreplayedInitialData('prompt', [' then ', 'more'])).toBe(' then more');
  });

  it('drops queued chunks already present at the end of the replay buffer', () => {
    expect(getUnreplayedInitialData('prompt then ', [' then ', 'more'])).toBe('more');
    expect(getUnreplayedInitialData('prompt then more', [' then ', 'more'])).toBe('');
  });
});

describe('getTerminalDataAfterInitialReplayEcho', () => {
  it('drops delayed startup data that was already written from the initial buffer', () => {
    expect(getTerminalDataAfterInitialReplayEcho({
      data: 'fieldtheory experimental › ',
      initialReplayEchoTail: 'fieldtheory experimental › ',
      initialReplayEchoUntil: 2000,
      now: 1000,
    })).toEqual({
      data: '',
      initialReplayEchoTail: 'fieldtheory experimental › ',
    });
  });

  it('keeps only the unreplayed suffix when delayed startup data overlaps the buffer', () => {
    expect(getTerminalDataAfterInitialReplayEcho({
      data: 'experimental › next',
      initialReplayEchoTail: 'fieldtheory experimental › ',
      initialReplayEchoUntil: 2000,
      now: 1000,
    })).toEqual({
      data: 'next',
      initialReplayEchoTail: 'fieldtheory experimental › next',
    });
  });

  it('passes data through after the startup dedupe window expires', () => {
    expect(getTerminalDataAfterInitialReplayEcho({
      data: 'fieldtheory experimental › ',
      initialReplayEchoTail: 'fieldtheory experimental › ',
      initialReplayEchoUntil: 1000,
      now: 2000,
    })).toEqual({
      data: 'fieldtheory experimental › ',
      initialReplayEchoTail: '',
    });
  });
});

describe('terminalTheme', () => {
  it('uses the Ghostty dark palette and visible light ANSI values', () => {
    expect(terminalTheme(false)?.background).toBe('#f4ecdc');
    expect(terminalTheme(false)?.foreground).toBe('#0f172a');
    expect(terminalTheme(false)?.white).toBe('#374151');
    expect(terminalTheme(false)?.brightBlack).toBe('#374151');
    expect(terminalTheme(false)?.brightWhite).toBe('#111827');
    expect(terminalTheme(true)?.background).toBe('#0F1115');
    expect(terminalTheme(true)?.foreground).toBe('#E6EAF0');
    expect(terminalTheme(true)?.cursor).toBe('#7AA2F7');
    expect(terminalTheme(true)?.white).toBe('#C0CAF5');
    expect(terminalTheme(true)?.brightWhite).toBe('#E6EAF0');
  });

  it('raises light terminal contrast for diff backgrounds', () => {
    expect(terminalContrastRatio(false)).toBe(7);
    expect(terminalContrastRatio(true)).toBe(1);
  });
});

describe('terminalAppearanceOptions', () => {
  it('keeps Ghostty-style terminal appearance together for live theme changes', () => {
    expect(terminalAppearanceOptions(true)).toMatchObject({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      fontFamily: 'Berkeley Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12.5,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.28,
      minimumContrastRatio: terminalContrastRatio(true),
      theme: terminalTheme(true),
    });
    expect(terminalAppearanceOptions(false)).toMatchObject({
      minimumContrastRatio: terminalContrastRatio(false),
      theme: terminalTheme(false),
    });
  });
});

describe('estimateCodexTerminalSize', () => {
  it('estimates PTY dimensions from the visible terminal panel', () => {
    expect(estimateCodexTerminalSize({ width: 720, height: 360 })).toEqual({
      cols: 93,
      rows: 17,
    });
  });

  it('accounts for the extended top toolbar inset', () => {
    expect(estimateCodexTerminalSize({ width: 720, height: 380, toolbarTopInset: 8 })).toEqual({
      cols: 93,
      rows: 18,
    });
  });
});

describe('getTerminalTopExtension', () => {
  it('extends the right dock to the viewport top from its current panel top', () => {
    expect(getTerminalTopExtension({ panelTop: 52.4, previousTopExtension: 0 })).toBe(52);
  });

  it('does not accumulate drift after the panel has already been pulled upward', () => {
    expect(getTerminalTopExtension({ panelTop: 0.2, previousTopExtension: 52 })).toBe(52);
  });
});

describe('getTerminalResizeDimension', () => {
  it('calculates bottom-dock drag height within the allowed panel range', () => {
    expect(getTerminalResizeDimension({
      dockSide: 'bottom',
      startBottomHeight: 300,
      startRightWidth: 500,
      startX: 0,
      startY: 500,
      currentX: 0,
      currentY: 450,
      windowWidth: 1200,
      windowHeight: 800,
    })).toEqual({ bottomHeight: 350 });
  });

  it('clamps right-dock drag width within the allowed panel range', () => {
    expect(getTerminalResizeDimension({
      dockSide: 'right',
      startBottomHeight: 300,
      startRightWidth: 500,
      startX: 700,
      startY: 0,
      currentX: 100,
      currentY: 0,
      windowWidth: 1000,
      windowHeight: 800,
    })).toEqual({ rightWidth: 680 });
  });
});

describe('resolveCodexTerminalDockSide', () => {
  it('uses the persisted user dock side when there is no responsive override', () => {
    expect(resolveCodexTerminalDockSide({ dockSide: 'right' })).toBe('right');
  });

  it('uses a responsive override for rendering without changing the user dock side input', () => {
    const userDockSide = 'right';
    expect(resolveCodexTerminalDockSide({ dockSide: userDockSide, dockSideOverride: 'bottom' })).toBe('bottom');
    expect(userDockSide).toBe('right');
  });
});

describe('shouldUseCompactRightDockToolbar', () => {
  it('compacts cramped right-docked toolbars', () => {
    expect(shouldUseCompactRightDockToolbar({ dockSide: 'right', rightWidth: 420 })).toBe(true);
  });

  it('does not compact bottom-docked toolbars', () => {
    expect(shouldUseCompactRightDockToolbar({ dockSide: 'bottom', rightWidth: 360 })).toBe(false);
  });

  it('uses the responsive override when deciding whether the toolbar is right-docked', () => {
    expect(shouldUseCompactRightDockToolbar({ dockSide: 'bottom', dockSideOverride: 'right', rightWidth: 420 })).toBe(true);
  });
});

describe('terminalViewportStyleCss', () => {
  it('hides xterm viewport scrollbars against global app scrollbar styling', () => {
    const css = terminalViewportStyleCss('#f0eadf');
    expect(css).toContain('.codex-terminal-host {\n  overflow: hidden;');
    expect(css).toContain('padding: 20px 24px;');
    expect(css).toContain('background-color: #f0eadf !important');
    expect(css).toContain('.codex-terminal-mount {');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('height: 100%;');
    expect(css).not.toContain('calc(100% -');
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
