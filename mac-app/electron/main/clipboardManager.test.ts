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

import {
  buildScreencaptureCommand,
  ClipboardManager,
  isIDEWithTerminal,
  isTerminalApp,
  orderStackItemsForPaste,
  shouldPasteMixedStackImagesFirst,
} from './clipboardManager';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private members in tests
function createManager(): any {
  const manager = new ClipboardManager();
  (manager as any).storeText = vi.fn(async () => 1);
  (manager as any).storeImage = vi.fn(async () => 2);
  return manager;
}

describe('ClipboardManager.loadHotkeysFromPreferences', () => {
  it('treats empty strings as explicit clears', () => {
    const manager = new ClipboardManager();

    manager.loadHotkeysFromPreferences('', 'Alt+Space', '', '');

    expect(manager.getHotkeys()).toMatchObject({
      screenshot: '',
      history: 'Alt+Space',
      fullScreen: '',
      activeWindow: '',
    });
  });

  it('leaves defaults in place only when a preference is absent', () => {
    const manager = new ClipboardManager();

    manager.loadHotkeysFromPreferences(undefined, undefined, undefined, undefined);

    expect(manager.getHotkeys()).toMatchObject({
      screenshot: 'Alt+4',
      history: 'Alt+Space',
      fullScreen: 'Alt+3',
      activeWindow: 'Shift+Alt+3',
    });
  });

  it('does not mark cleared hotkeys as registered', () => {
    const manager: any = new ClipboardManager();

    manager.loadHotkeysFromPreferences('', '', '', '');
    manager.registerScreenshotHotkey(vi.fn());
    manager.registerFullScreenHotkey(vi.fn());
    manager.registerActiveWindowHotkey(vi.fn());
    manager.registerHistoryHotkey(vi.fn());

    expect(manager.screenshotHotkeyRegistered).toBe(false);
    expect(manager.fullScreenHotkeyRegistered).toBe(false);
    expect(manager.activeWindowHotkeyRegistered).toBe(false);
    expect(manager.historyHotkeyRegistered).toBe(false);
  });
});

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

  it('keeps portable command launcher transport text out of clipboard history', async () => {
    const transportText = '[mail.md]\n/Users/afar/.fieldtheory/library/Commands/mail.md ';
    testState.readText.mockReturnValue(transportText);

    manager.syncClipboardHash();
    await manager.checkClipboard();

    expect(manager.storeText).not.toHaveBeenCalled();

    testState.readText.mockReturnValue('real user copy');
    await manager.checkClipboard();

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

  it('bumps created_at for duplicate text so it appears at the top', async () => {
    testState.readText.mockReturnValue('existing text');
    const runFn = vi.fn();
    testState.dbPrepare.mockReturnValue({
      get: vi.fn(() => ({ id: 42 })),
      run: runFn,
      all: vi.fn(() => []),
    });

    const before = Date.now();
    await manager.checkClipboard();
    const after = Date.now();

    // Should have called UPDATE to bump created_at
    expect(runFn).toHaveBeenCalled();
    const [timestamp, , , id] = runFn.mock.calls[0];
    expect(id).toBe(42);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
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

  it('does not re-encode the same image on every clipboard poll', async () => {
    testState.readText.mockReturnValue('');
    testState.availableFormats.mockReturnValue(['image/png']);
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const toPNG = vi.fn(() => imageBuffer);
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG,
      getSize: () => ({ width: 100, height: 100 }),
      resize: vi.fn(() => ({ toPNG: () => Buffer.from([0x89]) })),
    });

    await manager.checkClipboard();
    await manager.checkClipboard();

    expect(toPNG).toHaveBeenCalledTimes(1);
    expect(manager.storeImage).toHaveBeenCalledTimes(1);
  });

  it('skips oversized automatic image capture before PNG encoding', async () => {
    testState.readText.mockReturnValue('');
    const toPNG = vi.fn(() => Buffer.from([1, 2, 3]));
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG,
      getSize: () => ({ width: 5712, height: 4284 }),
    });

    await manager.checkClipboard();

    expect(toPNG).not.toHaveBeenCalled();
    expect(manager.storeImage).not.toHaveBeenCalled();
  });

  it('skips automatic image capture when the encoded PNG is too large', async () => {
    testState.readText.mockReturnValue('');
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.alloc(10 * 1024 * 1024 + 1),
      getSize: () => ({ width: 1000, height: 1000 }),
    });

    await manager.checkClipboard();

    expect(manager.storeImage).not.toHaveBeenCalled();
  });

  it('does not export oversized current clipboard images through the global pasteboard fallback', async () => {
    const toPNG = vi.fn(() => Buffer.from([1, 2, 3]));
    testState.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG,
      getSize: () => ({ width: 5712, height: 4284 }),
    });

    await expect(manager.exportCurrentClipboardImageToCache()).resolves.toBeNull();
    expect(toPNG).not.toHaveBeenCalled();
    expect(manager.storeImage).not.toHaveBeenCalled();
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
    manager.lastImagePollCheckedAt = 0;
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

describe('ClipboardManager.storeImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not dedupe explicit screenshot captures by content hash', async () => {
    const manager: any = new ClipboardManager();
    manager.getFrontmostApp = vi.fn(async () => null);
    manager.cleanupOldItems = vi.fn();

    const insertRun = vi.fn(() => ({ lastInsertRowid: 77 }));
    testState.dbPrepare.mockClear();
    (testState.dbPrepare as any).mockImplementation((sql: string): any => {
      if (sql.includes('SELECT id FROM clipboard_items WHERE content_hash = ?')) {
        return { get: vi.fn(() => ({ id: 42 })) };
      }
      if (sql.includes('INSERT INTO clipboard_items')) {
        return { run: insertRun };
      }
      return {
        get: vi.fn(() => undefined),
        run: vi.fn(),
        all: vi.fn(() => []),
      };
    });

    const image = {
      getSize: () => ({ width: 100, height: 80 }),
      resize: () => ({ toPNG: () => Buffer.from([0x01]) }),
    };

    const id = await manager.storeImage(
      image,
      Buffer.from([0x89, 0x50]),
      'screenshot'
    );

    expect(id).toBe(77);
    expect(insertRun).toHaveBeenCalledTimes(1);
    const preparedSql = (testState.dbPrepare as any).mock.calls.map(([sql]: [unknown]) => String(sql));
    expect(preparedSql.some((sql: string) => sql.includes('SELECT id FROM clipboard_items WHERE content_hash = ?'))).toBe(false);
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

describe('isTerminalApp', () => {
  it('treats Ghostty as a terminal target for portable command text references', () => {
    expect(isTerminalApp('com.mitchellh.ghostty')).toBe(true);
  });
});

describe('mixed multimodal stack ordering', () => {
  const textItem = { id: 1, type: 'text', content: 'summarize this', imageData: null } as const;
  const transcriptItem = { id: 2, type: 'transcript', content: 'and compare it', imageData: null } as const;
  const imageItem = { id: 3, type: 'screenshot', content: null, imageData: Buffer.from([1, 2, 3]) } as const;

  it('pastes attachments before text for mixed non-terminal, non-IDE stacks', () => {
    expect(shouldPasteMixedStackImagesFirst('com.openai.chat', [textItem, imageItem])).toBe(true);
    expect(orderStackItemsForPaste([textItem, imageItem, transcriptItem], 'com.openai.chat').map(item => item.id)).toEqual([3, 1, 2]);
  });

  it('keeps IDE-terminal stacks in their original order', () => {
    expect(shouldPasteMixedStackImagesFirst('com.anthropic.claudefordesktop', [textItem, imageItem])).toBe(false);
    expect(orderStackItemsForPaste([textItem, imageItem, transcriptItem], 'com.anthropic.claudefordesktop').map(item => item.id)).toEqual([1, 3, 2]);
  });

  it('keeps terminal stacks in their original order', () => {
    expect(shouldPasteMixedStackImagesFirst('com.mitchellh.ghostty', [textItem, imageItem])).toBe(false);
    expect(orderStackItemsForPaste([textItem, imageItem, transcriptItem], 'com.mitchellh.ghostty').map(item => item.id)).toEqual([1, 3, 2]);
  });

  it('leaves image-only stacks untouched', () => {
    expect(shouldPasteMixedStackImagesFirst('com.anthropic.claudefordesktop', [imageItem])).toBe(false);
    expect(orderStackItemsForPaste([imageItem], 'com.anthropic.claudefordesktop').map(item => item.id)).toEqual([3]);
  });
});
