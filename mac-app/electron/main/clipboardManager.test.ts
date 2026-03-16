import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Hoisted mocks (must be defined before any vi.mock) ---

const testState = vi.hoisted(() => {
  const readText = vi.fn((): string => '');
  const readImage = vi.fn((): any => ({ isEmpty: () => true, toPNG: () => Buffer.from([]) }));
  const availableFormats = vi.fn((): string[] => []);

  const dbPrepare = vi.fn((): any => ({
    get: vi.fn(() => undefined),
    run: vi.fn(),
    all: vi.fn(() => []),
  }));

  const dbInstance = {
    prepare: dbPrepare,
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };

  return { readText, readImage, availableFormats, dbPrepare, dbInstance };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
  clipboard: {
    readText: testState.readText,
    readImage: testState.readImage,
    availableFormats: testState.availableFormats,
    writeText: vi.fn(),
    writeImage: vi.fn(),
  },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 100, height: 100 }),
      toPNG: () => Buffer.from([0x89, 0x50]),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    })),
  },
  systemPreferences: {
    getUserDefault: vi.fn(),
  },
}));

vi.mock('better-sqlite3', () => {
  return {
    default: function Database() {
      return testState.dbInstance;
    },
  };
});

vi.mock('./hotkeyManager', () => ({
  getHotkeyManager: () => ({
    register: vi.fn(() => ({ success: true })),
    unregister: vi.fn(),
  }),
  HotkeyId: {},
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { buildScreencaptureCommand, ClipboardManager, isIDEWithTerminal } from './clipboardManager';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private members in tests
function createManager(): any {
  const manager = new ClipboardManager();
  (manager as any).storeText = vi.fn(async () => 1);
  (manager as any).storeImage = vi.fn(async () => 2);
  return manager;
}

describe('ClipboardManager.checkClipboard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    testState.readText.mockReturnValue('');
    testState.readImage.mockReturnValue({ isEmpty: () => true, toPNG: () => Buffer.from([]) });
    testState.availableFormats.mockReturnValue([]);
    // Reset DB mock to return no existing items
    testState.dbPrepare.mockReturnValue({
      get: vi.fn(() => undefined),
      run: vi.fn(),
      all: vi.fn(() => []),
    });
    manager = createManager();
    // Reset hash so every test starts fresh
    manager.lastContentHash = '';
  });

  it('stores new text content', async () => {
    testState.readText.mockReturnValue('hello world');

    await manager.checkClipboard();

    expect(manager.storeText).toHaveBeenCalledTimes(1);
  });

  it('does not re-store text with the same hash', async () => {
    testState.readText.mockReturnValue('hello world');

    await manager.checkClipboard();
    await manager.checkClipboard();

    // Only stored once — second call sees same hash
    expect(manager.storeText).toHaveBeenCalledTimes(1);
  });

  it('notifies callback for duplicate text already in DB', async () => {
    testState.readText.mockReturnValue('existing text');
    testState.dbPrepare.mockReturnValue({
      get: vi.fn(() => ({ id: 42 })),
      run: vi.fn(),
      all: vi.fn(() => []),
    });
    const onItemAdded = vi.fn();
    manager.onItemAddedCallback = onItemAdded;

    await manager.checkClipboard();

    expect(manager.storeText).not.toHaveBeenCalled();
    expect(onItemAdded).toHaveBeenCalledWith(42);
  });

  it('fires clipboard change callback on new content', async () => {
    testState.readText.mockReturnValue('new text');
    const onChange = vi.fn();
    manager.onClipboardChangeCallback = onChange;

    await manager.checkClipboard();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not fire clipboard change callback when hash unchanged', async () => {
    testState.readText.mockReturnValue('same text');

    await manager.checkClipboard();

    const onChange = vi.fn();
    manager.onClipboardChangeCallback = onChange;

    // Same text again
    await manager.checkClipboard();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores new image content', async () => {
    testState.readText.mockReturnValue('');
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => imageBuffer,
      getSize: () => ({ width: 100, height: 100 }),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    });

    await manager.checkClipboard();

    expect(manager.storeImage).toHaveBeenCalledTimes(1);
  });

  it('captures different images even when clipboard formats are identical', async () => {
    // This is the bug we fixed — previously, same formats would short-circuit
    testState.readText.mockReturnValue('');
    testState.availableFormats.mockReturnValue(['image/png']);

    const imageA = Buffer.from([1, 2, 3]);
    const imageB = Buffer.from([4, 5, 6]);

    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => imageA,
      getSize: () => ({ width: 100, height: 100 }),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    });
    await manager.checkClipboard();

    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => imageB,
      getSize: () => ({ width: 100, height: 100 }),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    });
    await manager.checkClipboard();

    // Both images should be stored — this was the bug
    expect(manager.storeImage).toHaveBeenCalledTimes(2);
  });

  it('skips clipboard check when screenshot is in progress', async () => {
    manager.screenshotInProgress = true;
    testState.readText.mockReturnValue('should be ignored');

    await manager.checkClipboard();

    expect(manager.storeText).not.toHaveBeenCalled();
  });

  it('catches errors without throwing', async () => {
    testState.readText.mockImplementation(() => {
      throw new Error('clipboard locked');
    });

    // Should not throw
    await expect(manager.checkClipboard()).resolves.toBeUndefined();
    expect(manager.storeText).not.toHaveBeenCalled();
  });

  it('skips empty clipboard (no text, no image)', async () => {
    testState.readText.mockReturnValue('');
    testState.readImage.mockReturnValue({ isEmpty: () => true, toPNG: () => Buffer.from([]) });

    await manager.checkClipboard();

    expect(manager.storeText).not.toHaveBeenCalled();
    expect(manager.storeImage).not.toHaveBeenCalled();
  });

  it('prefers text over image when both are present', async () => {
    testState.readText.mockReturnValue('has text');
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
    });

    await manager.checkClipboard();

    expect(manager.storeText).toHaveBeenCalledTimes(1);
    expect(manager.storeImage).not.toHaveBeenCalled();
  });

  it('detects text-to-image transitions', async () => {
    // First: text
    testState.readText.mockReturnValue('some text');
    await manager.checkClipboard();
    expect(manager.storeText).toHaveBeenCalledTimes(1);

    // Then: image (no text)
    testState.readText.mockReturnValue('');
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from([0x89, 0x50, 0x4e]),
      getSize: () => ({ width: 50, height: 50 }),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    });
    await manager.checkClipboard();

    expect(manager.storeImage).toHaveBeenCalledTimes(1);
  });
});

describe('buildScreencaptureCommand', () => {
  it('removes window shadow in interactive capture mode', () => {
    expect(buildScreencaptureCommand({ region: true })).toBe('screencapture -i -o -c');
    expect(
      buildScreencaptureCommand({
        region: true,
        saveToDesktop: true,
        capturePath: '/tmp/capture.png',
      })
    ).toBe('screencapture -i -o "/tmp/capture.png"');
  });

  it('removes window shadow for active-window capture', () => {
    expect(
      buildScreencaptureCommand({
        activeWindow: true,
        capturePath: '/tmp/window.png',
      })
    ).toBe('screencapture -w -o "/tmp/window.png"');
  });
});

describe('isIDEWithTerminal', () => {
  it('treats Codex desktop like Cursor and Claude for portable commands', () => {
    expect(isIDEWithTerminal('com.anthropic.claudefordesktop')).toBe(true);
    expect(isIDEWithTerminal('com.todesktop.230313mzl4w4u92')).toBe(true);
    expect(isIDEWithTerminal('com.openai.codex')).toBe(true);
  });
});
