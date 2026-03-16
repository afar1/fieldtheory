import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DiagnosticsCollector } from './diagnosticsCollector';

describe('DiagnosticsCollector audio diagnostics', () => {
  it('drops malformed audio devices instead of throwing', () => {
    const collector = Object.create(DiagnosticsCollector.prototype) as any;
    collector.audioManager = {
      getState: () => ({
        devices: [
          undefined,
          null,
          { id: 'mic-1', name: 'Built-in Mic', isInput: true, isOutput: false },
          { id: 'bad-1', isInput: true, isOutput: false },
          { id: 'bad-2', name: 123, isInput: true, isOutput: false },
        ],
        defaultInputId: 'mic-1',
        priorityMode: true,
        priorityDeviceId: 'mic-1',
        userOverrideId: null,
      }),
    };

    const audio = collector.collectAudioInfo();

    expect(audio.priorityDeviceName).toBe('Built-in Mic');
    expect(audio.currentDefaultInput).toBe('Built-in Mic');
    expect(audio.devices).toEqual([
      {
        id: 'mic-1',
        name: 'Built-in Mic',
        isInput: true,
      },
    ]);
  });

  it('formats expanded diagnostics markdown with issues and transcription sections', () => {
    const collector = new DiagnosticsCollector({ getPreference: vi.fn() } as any);
    const markdown = collector.formatAsMarkdown({
      timestamp: '2026-03-16T00:00:00.000Z',
      issues: ['Parakeet English needs reinstall: startup timed out'],
      system: {
        appVersion: '0.1.94-test',
        electronVersion: '31.7.7',
        nodeVersion: '22.0.0',
        macOSVersion: '25.3.0',
        architecture: 'arm64',
        cpuModel: 'Apple M4 Max',
        cpuCores: 16,
        totalMemoryGB: 128,
        freeMemoryGB: 16,
      },
      app: {
        userDataPath: '/tmp/fieldtheory',
        onboardingComplete: true,
        onboardingStep: 3,
        isPackaged: false,
        networkOnline: true,
      },
      transcription: {
        selectedEngine: 'parakeet',
        engineStatus: {
          selectedEngine: 'parakeet',
          source: 'global',
          whisperModel: 'small',
          readiness: 'disabled',
          detail: 'Parakeet English needs reinstall: startup timed out',
          fallbackAvailable: true,
        },
        whisperModels: {
          selectedModel: 'small',
          modelsDirectory: '/tmp/models',
          activeDownloads: [],
          models: [
            {
              size: 'small',
              selected: true,
              downloaded: true,
              fileSizeMB: 465,
              path: '/tmp/models/ggml-small.en.bin',
            },
          ],
        },
        parakeet: {
          runtimeInstalled: true,
          pythonPath: '/tmp/build-parakeet/venv/bin/python',
          scriptPath: '/tmp/scripts/parakeet-transcribe.py',
          cacheDir: '/tmp/build-parakeet/cache',
          cacheExists: true,
          serverState: 'idle',
          activeEngine: null,
          engines: [
            {
              engine: 'parakeet',
              label: 'Parakeet English',
              verified: false,
              needsReinstall: true,
              lastError: 'startup timed out',
              lastErrorAt: '2026-03-16T00:00:00.000Z',
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: false,
              needsReinstall: false,
              lastError: null,
              lastErrorAt: null,
            },
          ],
        },
      },
      audio: {
        priorityMode: true,
        priorityDeviceId: 'mic-1',
        priorityDeviceName: 'Built-in Mic',
        currentDefaultInput: 'Built-in Mic',
        devices: [{ id: 'mic-1', name: 'Built-in Mic', isInput: true }],
      },
      hotMic: {
        enabled: true,
        muted: false,
        soundsEnabled: true,
        allowWhisperFallback: true,
        hotkey: null,
        targetBundleId: 'com.mitchellh.ghostty',
        submitWord: 'go',
        backgroundFilterEnabled: true,
        backgroundFilterStrength: 4,
        drawerTextSize: 14,
      },
      windowManagement: {
        enabled: true,
        showInCommandLauncher: true,
        focusHeightPercent: 80,
        focusWidthPercent: 60,
        horizontalHeightPercent: 80,
        horizontalKeepHeight: true,
        horizontalHideOthers: true,
      },
      commands: {
        launcherHotkey: 'Command+Shift+K',
        commandsDirectory: '/tmp/commands',
        commandsDirectoryExists: false,
      },
      interface: {
        transcriptionHotkey: '',
        clipboardHistoryHotkey: 'Alt+Space',
        screenshotHotkey: 'Alt+4',
        continuousContextEnabled: false,
        continuousContextHotkey: 'Shift+Alt+4',
        superPasteHotkey: 'Command+Shift+V',
        soundsEnabled: false,
        librarianSoundEnabled: true,
        cursorStatusEnabled: true,
        hideStatusLabels: false,
        showInDock: false,
        darkMode: false,
        performanceHudEnabled: false,
        launchAtLogin: false,
        dataRetentionDays: -1,
      },
      support: {
        consoleLogTip: 'For detailed error logs, open Console.app and filter by "Field Theory"',
      },
    });

    expect(markdown).toContain('### Detected Issues');
    expect(markdown).toContain('### Transcription');
    expect(markdown).toContain('Parakeet English: needs reinstall');
    expect(markdown).toContain('### Hot Mic');
    expect(markdown).toContain('### Window Management');
    expect(markdown).toContain('### Portable Commands');
    expect(markdown).toContain('Transcription Hotkey: unset');
  });
});
