import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: {},
}));

import {
  COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
  CommandClipboardRestoreCoordinator,
  captureCommandClipboardPayload,
  captureClipboardSnapshot,
  clipboardMatchesCommandPayload,
  formatCommandFilePasteText,
  restoreClipboardSnapshot,
  resolveCommandFilePasteDelivery,
  resolveCommandFilePasteMode,
  shouldUseNativeCommandLauncherClipboardTextPaste,
  shouldUseNativeCommandFileTyping,
  waitForCommandClipboardPasteRead,
  type CommandClipboard,
} from './commandClipboard';

function fakeImage(empty = false) {
  return { isEmpty: () => empty } as ReturnType<CommandClipboard['readImage']>;
}

function fakeClipboard(overrides: Partial<CommandClipboard> = {}): CommandClipboard {
  return {
    availableFormats: vi.fn(() => []),
    readBuffer: vi.fn(() => Buffer.alloc(0)),
    readText: vi.fn(() => ''),
    readImage: vi.fn(() => fakeImage(true)),
    clear: vi.fn(),
    writeBuffer: vi.fn(),
    writeText: vi.fn(),
    writeImage: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('captureClipboardSnapshot', () => {
  it('captures readable native formats and skips unreadable or empty formats', () => {
    const png = Buffer.from([1, 2, 3]);
    const image = fakeImage();
    const source = fakeClipboard({
      availableFormats: vi.fn(() => ['public.png', 'private-format', 'empty-format']),
      readBuffer: vi.fn((format: string) => {
        if (format === 'private-format') throw new Error('unreadable');
        if (format === 'empty-format') return Buffer.alloc(0);
        return png;
      }),
      readText: vi.fn(() => 'previous text'),
      readImage: vi.fn(() => image),
    });

    expect(captureClipboardSnapshot(source)).toEqual({
      formats: [{ format: 'public.png', buffer: png }],
      text: 'previous text',
      image,
    });
  });
});

describe('restoreClipboardSnapshot', () => {
  it('restores native formats without falling back to text or image', () => {
    const target = fakeClipboard();
    const buffer = Buffer.from([4, 5, 6]);

    restoreClipboardSnapshot({
      formats: [{ format: 'public.file-url', buffer }],
      text: 'previous text',
      image: fakeImage(),
    }, target);

    expect(target.clear).toHaveBeenCalledOnce();
    expect(target.writeBuffer).toHaveBeenCalledWith('public.file-url', buffer);
    expect(target.writeText).not.toHaveBeenCalled();
    expect(target.writeImage).not.toHaveBeenCalled();
  });

  it('falls back to text and image when no native formats restore', () => {
    const image = fakeImage();
    const target = fakeClipboard({
      writeBuffer: vi.fn(() => {
        throw new Error('cannot restore');
      }),
    });

    restoreClipboardSnapshot({
      formats: [{ format: 'private-format', buffer: Buffer.from([1]) }],
      text: 'previous text',
      image,
    }, target);

    expect(target.clear).toHaveBeenCalledOnce();
    expect(target.writeText).toHaveBeenCalledWith('previous text');
    expect(target.writeImage).toHaveBeenCalledWith(image);
  });
});

describe('CommandClipboardRestoreCoordinator', () => {
  it('keeps the original snapshot across overlapping command pastes', () => {
    const coordinator = new CommandClipboardRestoreCoordinator();
    const original = {
      formats: [],
      text: 'original clipboard',
      image: fakeImage(true),
    };
    const commandPayload = {
      formats: [],
      text: '[commit.md]',
      image: fakeImage(true),
    };

    const first = coordinator.begin(original);
    const second = coordinator.begin(commandPayload);

    expect(first.snapshot).toBe(original);
    expect(second.snapshot).toBe(original);
    expect(coordinator.canRestore(first.generation)).toBe(false);
    expect(coordinator.canRestore(second.generation)).toBe(true);
  });

  it('clears the pending snapshot after the newest paste restores', () => {
    const coordinator = new CommandClipboardRestoreCoordinator();
    const original = {
      formats: [],
      text: 'original clipboard',
      image: fakeImage(true),
    };
    const nextOriginal = {
      formats: [],
      text: 'next original clipboard',
      image: fakeImage(true),
    };

    const first = coordinator.begin(original);
    coordinator.finish(first.generation);
    expect(coordinator.canRestore(first.generation)).toBe(false);

    const second = coordinator.begin(nextOriginal);

    expect(second.snapshot).toBe(nextOriginal);
  });
});

describe('waitForCommandClipboardPasteRead', () => {
  it('waits for the configured command clipboard restore delay', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    const promise = waitForCommandClipboardPasteRead().then(settled);

    await vi.advanceTimersByTimeAsync(COMMAND_CLIPBOARD_RESTORE_DELAY_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toHaveBeenCalledOnce();
  });
});

describe('clipboardMatchesCommandPayload', () => {
  it('matches the launcher payload while the clipboard still contains it', () => {
    const textBuffer = Buffer.from('command text');
    const source = fakeClipboard({
      availableFormats: vi.fn(() => ['text/plain']),
      readText: vi.fn(() => 'command text'),
      readBuffer: vi.fn(() => textBuffer),
    });

    const payload = captureCommandClipboardPayload(source);

    expect(clipboardMatchesCommandPayload(payload, source)).toBe(true);
  });

  it('does not match after the user copies different text', () => {
    const source = fakeClipboard({
      availableFormats: vi.fn(() => ['text/plain']),
      readText: vi.fn()
        .mockReturnValueOnce('command text')
        .mockReturnValue('user text'),
      readBuffer: vi.fn(() => Buffer.from('command text')),
    });

    const payload = captureCommandClipboardPayload(source);

    expect(clipboardMatchesCommandPayload(payload, source)).toBe(false);
  });

  it('does not match after the clipboard file formats change', () => {
    const source = fakeClipboard({
      availableFormats: vi.fn()
        .mockReturnValueOnce(['text/plain', 'public.file-url'])
        .mockReturnValue(['text/plain']),
      readText: vi.fn(() => '/tmp/command.md'),
      readBuffer: vi.fn((format: string) => Buffer.from(format)),
    });

    const payload = captureCommandClipboardPayload(source);

    expect(clipboardMatchesCommandPayload(payload, source)).toBe(false);
  });
});

describe('resolveCommandFilePasteMode', () => {
  it('keeps terminal-style targets on text references', () => {
    expect(resolveCommandFilePasteMode({ isTerminal: true, isIDE: false })).toBe('text-reference');
  });

  it('keeps IDE terminal-style targets on text references', () => {
    expect(resolveCommandFilePasteMode({ isTerminal: false, isIDE: true })).toBe('text-reference');
  });

  it('uses markdown content for generic rich composer targets without app names', () => {
    expect(resolveCommandFilePasteMode({ isTerminal: false, isIDE: false })).toBe('markdown-content');
  });
});

describe('shouldUseNativeCommandFileTyping', () => {
  it('skips native typing for terminal text references so target inputs keep normal paste focus', () => {
    expect(shouldUseNativeCommandFileTyping({
      mode: 'text-reference',
      isTerminal: true,
      isIDE: false,
    })).toBe(false);
  });

  it('skips native typing for IDE text references so target inputs keep normal paste focus', () => {
    expect(shouldUseNativeCommandFileTyping({
      mode: 'text-reference',
      isTerminal: false,
      isIDE: true,
    })).toBe(false);
  });

  it('keeps native typing available for markdown content targets', () => {
    expect(shouldUseNativeCommandFileTyping({
      mode: 'markdown-content',
      isTerminal: false,
      isIDE: false,
    })).toBe(true);
  });
});

describe('resolveCommandFilePasteDelivery', () => {
  it('uses normal paste for IDE command-file references so typing can continue afterward', () => {
    expect(resolveCommandFilePasteDelivery({
      mode: 'text-reference',
      isTerminal: false,
      isIDE: true,
    })).toBe('clipboard-paste');
  });

  it('uses normal paste for terminal command-file references so typing can continue afterward', () => {
    expect(resolveCommandFilePasteDelivery({
      mode: 'text-reference',
      isTerminal: true,
      isIDE: false,
    })).toBe('clipboard-paste');
  });

  it('keeps rich composer markdown content on native-helper delivery', () => {
    expect(resolveCommandFilePasteDelivery({
      mode: 'markdown-content',
      isTerminal: false,
      isIDE: false,
    })).toBe('native-helper');
  });
});

describe('shouldUseNativeCommandLauncherClipboardTextPaste', () => {
  it('uses native typing for command launcher clipboard text pastes', () => {
    expect(shouldUseNativeCommandLauncherClipboardTextPaste({
      commandLauncherPaste: true,
      hasTextContent: true,
    })).toBe(true);
  });

  it('keeps non-text clipboard launcher pastes on the regular paste path', () => {
    expect(shouldUseNativeCommandLauncherClipboardTextPaste({
      commandLauncherPaste: true,
      hasTextContent: false,
    })).toBe(false);
  });
});

describe('formatCommandFilePasteText', () => {
  it('formats portable command md files as command references for terminal-style targets', () => {
    expect(formatCommandFilePasteText({
      kind: 'command',
      name: 'review',
      filePath: '/Users/afar/.fieldtheory/library/Commands/review.md',
      mode: 'text-reference',
      markdownContent: '# Review',
    })).toBe('[review.md]\n/Users/afar/.fieldtheory/library/Commands/review.md ');
  });

  it('formats handoff md files as file references for terminal-style targets', () => {
    expect(formatCommandFilePasteText({
      kind: 'handoff',
      fileName: 'Research note.md',
      filePath: '/Users/afar/.fieldtheory/library/Research note.md',
      mode: 'text-reference',
      markdownContent: '# Research note',
    })).toBe('Research note.md\n/Users/afar/.fieldtheory/library/Research note.md ');
  });

  it('uses markdown content for portable command md files in rich composer targets', () => {
    expect(formatCommandFilePasteText({
      kind: 'command',
      name: 'review',
      filePath: '/Users/afar/.fieldtheory/library/Commands/review.md',
      mode: 'markdown-content',
      markdownContent: '# Review\nRun the review.',
    })).toBe('# Review\nRun the review.');
  });

  it('uses markdown content for handoff md files in rich composer targets', () => {
    expect(formatCommandFilePasteText({
      kind: 'handoff',
      fileName: 'Research note.md',
      filePath: '/Users/afar/.fieldtheory/library/Research note.md',
      mode: 'markdown-content',
      markdownContent: '# Research note\nUse this note.',
    })).toBe('# Research note\nUse this note.');
  });
});
