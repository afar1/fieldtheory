import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  class MockTray {
    static instances: MockTray[] = [];

    titles: string[] = [];
    image: unknown = null;
    tooltip = '';
    contextMenu: unknown = null;
    destroyed = false;

    constructor(image: unknown) {
      this.image = image;
      MockTray.instances.push(this);
    }

    setToolTip(tooltip: string): void {
      this.tooltip = tooltip;
    }

    setImage(image: unknown): void {
      this.image = image;
    }

    setTitle(title: string): void {
      this.titles.push(title);
    }

    setContextMenu(menu: unknown): void {
      this.contextMenu = menu;
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  return {
    MockTray,
    Menu: {
      buildFromTemplate: vi.fn((items: unknown[]) => items),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
      })),
    },
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => '/mock-app'),
      quit: vi.fn(),
    },
    net: {
      isOnline: vi.fn(() => true),
    },
  };
});

vi.mock('electron', () => ({
  Tray: electronMock.MockTray,
  Menu: electronMock.Menu,
  nativeImage: electronMock.nativeImage,
  app: electronMock.app,
  net: electronMock.net,
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TrayManager } from './trayManager';
import type { AudioState } from './types/audio';

class FakeAudioManager extends EventEmitter {
  state: AudioState = {
    priorityMode: true,
    priorityDeviceId: 'mac-mic',
    userOverrideId: null,
    defaultInputId: 'mac-mic',
    devices: [
      { id: 'mac-mic', name: 'MacBook Pro Microphone', isInput: true, isOutput: false },
    ],
  };

  getState(): AudioState {
    return this.state;
  }

  setPriorityDevice = vi.fn();
  setPriorityMode = vi.fn();
  clearUserOverride = vi.fn();
}

function createTrayManager(): { manager: TrayManager; tray: InstanceType<typeof electronMock.MockTray> } {
  const audioManager = new FakeAudioManager();
  const preferencesManager = {
    get: () => ({ onboardingComplete: true }),
  };
  const manager = new TrayManager(audioManager as any, undefined, preferencesManager as any);
  manager.init();
  const tray = electronMock.MockTray.instances[0];
  return { manager, tray };
}

describe('TrayManager recording waveform title', () => {
  beforeEach(() => {
    electronMock.MockTray.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the priority mic title with a live waveform while recording', () => {
    const { manager, tray } = createTrayManager();

    expect(tray.titles.at(-1)).toBe(':Mac');

    manager.setRecordingActive(true);
    expect(tray.titles.at(-1)).toBe('▁▁▁▁▁▁▁');

    manager.updateRecordingAudioLevel(0.05);
    expect(tray.titles.at(-1)).toBe('▁▁▁▁▁▁▅');

    manager.setRecordingActive(false);
    expect(tray.titles.at(-1)).toBe(':Mac');
  });

  it('keeps unread document count visible beside the recording waveform', () => {
    const { manager, tray } = createTrayManager();

    manager.setTaggedDocsUnreadCount(2);
    expect(tray.titles.at(-1)).toBe(':Mac •2');

    manager.setRecordingActive(true);
    expect(tray.titles.at(-1)).toBe('▁▁▁▁▁▁▁ •2');
  });
});
