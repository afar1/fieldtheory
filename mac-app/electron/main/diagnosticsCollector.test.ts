import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp'),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: true })),
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
              lastErrorDetail: 'Loading model...\nFetching 4 files: 42%',
              lastErrorAt: '2026-03-16T00:00:00.000Z',
            },
            {
              engine: 'parakeet-multilingual',
              label: 'Parakeet Multilingual',
              verified: false,
              needsReinstall: false,
              lastError: null,
              lastErrorDetail: null,
              lastErrorAt: null,
            },
          ],
        },
        standardRecording: {
          status: 'recording',
          source: 'microphone',
          activeSource: 'microphone',
          recordingAgeMs: 5000,
          helperRecordingActive: true,
          liveTranscriptChars: 12,
          queueDepth: 2,
          chunkProcessingInFlight: true,
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
        allowWhisperFallback: false,
        hotkey: null,
        targetBundleId: 'com.mitchellh.ghostty',
        submitWord: 'go',
        backgroundFilterEnabled: true,
        backgroundFilterStrength: 4,
        drawerTextSize: 14,
        runtime: {
          state: 'recording',
          condition: 'ready',
          engineReady: true,
          whisperFallbackActive: false,
          queueDepth: 1,
          lastChunkAgeMs: 250,
          chunksReceived: 3,
          micHealthy: true,
          engine: null,
          timing: {
            chunkIntervalMs: 1200,
            queueWaitMs: 15,
            transcribeMs: 420,
            postProcessMs: null,
            totalPipelineMs: null,
            avgTranscribeMs: null,
            avgTotalPipelineMs: null,
          },
        },
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
    expect(markdown).toContain('Parakeet English: latest verification failed');
    expect(markdown).toContain('Fetching 4 files: 42%');
    expect(markdown).toContain('Standard Recording Status: recording');
    expect(markdown).toContain('Standard Queue Depth: 2');
    expect(markdown).toContain('### Hot Mic');
    expect(markdown).toContain('Runtime Chunks Received: 3');
    expect(markdown).toContain('Runtime Last Chunk Age: 250ms');
    expect(markdown).toContain('### Window Management');
    expect(markdown).toContain('### Portable Commands');
    expect(markdown).toContain('Transcription Hotkey: unset');
  });
});
