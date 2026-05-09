import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: {},
}));

import {
  COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
  CommandClipboardRestoreCoordinator,
  captureClipboardSnapshot,
  restoreClipboardSnapshot,
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
