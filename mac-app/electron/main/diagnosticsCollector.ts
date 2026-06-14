import { app } from 'electron';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { PreferencesManager } from './preferences';
import { ModelManager, SUPPORTED_MODEL_SIZES } from './modelManager';
import { AudioManager } from './audioManager';
import { AudioDevice } from './types/audio';
import { DEFAULT_SQUARES_CONFIG, type SquaresConfig } from './types/squares';
import type { HotMicEngineStatus } from './types/hotMic';
import type { ParakeetStatus } from './types/transcribe';
import type { TranscriberManager } from './transcriberManager';
import { createLogger } from './logger';

const log = createLogger('Diagnostics');

interface ModelDiagnostics {
  size: string;
  selected: boolean;
  downloaded: boolean;
  fileSizeMB: number | null;
  path: string;
  error?: string;
}

type DiagnosticsTranscriber = Pick<
  TranscriberManager,
  'getConfiguredTranscriptionEngine' | 'getHotMicEngineStatus' | 'getParakeetStatus'
>;

export interface DiagnosticsReport {
  timestamp: string;
  issues: string[];
  system: {
    appVersion: string;
    electronVersion: string;
    nodeVersion: string;
    macOSVersion: string;
    architecture: string;
    cpuModel: string;
    cpuCores: number;
    totalMemoryGB: number;
    freeMemoryGB: number;
  };
  app: {
    userDataPath: string;
    onboardingComplete: boolean;
    onboardingStep: number | undefined;
    isPackaged: boolean;
    networkOnline: boolean;
  };
  transcription: {
    selectedEngine: string;
    engineStatus: HotMicEngineStatus | null;
    whisperModels: {
      selectedModel: string;
      modelsDirectory: string;
      models: ModelDiagnostics[];
      activeDownloads: string[];
    };
    parakeet: ParakeetStatus | null;
  };
  audio: {
    priorityMode: boolean;
    priorityDeviceId: string | null;
    priorityDeviceName: string | null;
    currentDefaultInput: string | null;
    devices: {
      id: string;
      name: string;
      isInput: boolean;
    }[];
  };
  hotMic: {
    enabled: boolean;
    muted: boolean;
    soundsEnabled: boolean;
    allowWhisperFallback: boolean;
    hotkey: string | null;
    targetBundleId: string | null;
    submitWord: string | null;
    backgroundFilterEnabled: boolean;
    backgroundFilterStrength: number | null;
    drawerTextSize: number | null;
  };
  windowManagement: {
    enabled: boolean;
    showInCommandLauncher: boolean;
    focusHeightPercent: number;
    focusWidthPercent: number;
    horizontalHeightPercent: number;
    horizontalKeepHeight: boolean;
    horizontalHideOthers: boolean;
  };
  commands: {
    launcherHotkey: string | null;
    commandsDirectory: string | null;
    commandsDirectoryExists: boolean | null;
  };
  interface: {
    transcriptionHotkey: string | null;
    clipboardHistoryHotkey: string | null;
    screenshotHotkey: string | null;
    continuousContextEnabled: boolean;
    continuousContextHotkey: string | null;
    superPasteHotkey: string | null;
    soundsEnabled: boolean;
    librarianSoundEnabled: boolean;
    cursorStatusEnabled: boolean;
    hideStatusLabels: boolean;
    showInDock: boolean;
    darkMode: boolean;
    performanceHudEnabled: boolean;
    launchAtLogin: boolean;
    dataRetentionDays: number | null;
  };
  support: {
    consoleLogTip: string;
  };
}

export class DiagnosticsCollector {
  private preferencesManager: PreferencesManager;
  private modelManager: ModelManager | null = null;
  private audioManager: AudioManager | null = null;
  private transcriberManager: DiagnosticsTranscriber | null = null;

  constructor(preferencesManager: PreferencesManager) {
    this.preferencesManager = preferencesManager;
  }

  setModelManager(modelManager: ModelManager): void {
    this.modelManager = modelManager;
  }

  setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager;
  }

  setTranscriberManager(transcriberManager: DiagnosticsTranscriber): void {
    this.transcriberManager = transcriberManager;
  }

  async collect(): Promise<DiagnosticsReport> {
    const transcription = await this.collectTranscriptionInfo();
    const commands = await this.collectCommandsInfo();
    const report: DiagnosticsReport = {
      timestamp: new Date().toISOString(),
      issues: [],
      system: this.collectSystemInfo(),
      app: this.collectAppInfo(),
      transcription,
      audio: this.collectAudioInfo(),
      hotMic: this.collectHotMicInfo(),
      windowManagement: this.collectWindowManagementInfo(),
      commands,
      interface: this.collectInterfaceInfo(),
      support: {
        consoleLogTip: 'For detailed error logs, open Console.app and filter by "Field Theory"',
      },
    };

    report.issues = this.collectIssues(report);
    return report;
  }

  formatAsMarkdown(report: DiagnosticsReport): string {
    const lines: string[] = [
      '## Field Theory Diagnostics',
      `Generated: ${report.timestamp}`,
      '',
    ];

    if (report.issues.length > 0) {
      lines.push('### Detected Issues');
      for (const issue of report.issues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    lines.push('### System');
    lines.push(`- App Version: ${report.system.appVersion}`);
    lines.push(`- macOS: ${report.system.macOSVersion}`);
    lines.push(`- Architecture: ${report.system.architecture}`);
    lines.push(`- CPU: ${report.system.cpuModel} (${report.system.cpuCores} cores)`);
    lines.push(`- Memory: ${report.system.totalMemoryGB} GB total, ${report.system.freeMemoryGB} GB free`);
    lines.push(`- Electron: ${report.system.electronVersion}`);
    lines.push(`- Node: ${report.system.nodeVersion}`);
    lines.push('');

    lines.push('### App State');
    lines.push(`- Onboarding Complete: ${report.app.onboardingComplete}`);
    lines.push(`- Onboarding Step: ${report.app.onboardingStep ?? 'N/A'}`);
    lines.push(`- Network: ${report.app.networkOnline ? 'online' : 'offline'}`);
    lines.push(`- Packaged: ${report.app.isPackaged}`);
    lines.push(`- User Data: ${report.app.userDataPath}`);
    lines.push('');

    lines.push('### Transcription');
    lines.push(`- Preferred Engine: ${report.transcription.selectedEngine}`);
    lines.push(`- Engine Readiness: ${report.transcription.engineStatus?.readiness ?? 'unknown'}`);
    lines.push(`- Engine Detail: ${formatOptionalText(report.transcription.engineStatus?.detail)}`);
    lines.push(`- Whisper Fallback Available: ${formatBoolean(report.transcription.engineStatus?.fallbackAvailable ?? false)}`);
    lines.push(`- Selected Whisper Model: ${report.transcription.whisperModels.selectedModel}`);
    lines.push(`- Whisper Models Directory: ${report.transcription.whisperModels.modelsDirectory}`);
    lines.push(`- Active Whisper Downloads: ${formatList(report.transcription.whisperModels.activeDownloads)}`);
    for (const model of report.transcription.whisperModels.models) {
      const status = model.downloaded
        ? `downloaded (${model.fileSizeMB?.toFixed(1)} MB)`
        : 'not downloaded';
      const selected = model.selected ? ' [SELECTED]' : '';
      const error = model.error ? ` - ${model.error}` : '';
      lines.push(`- Whisper ${model.size}: ${status}${selected}${error}`);
    }
    if (report.transcription.parakeet) {
      lines.push(`- Parakeet Runtime Installed: ${formatBoolean(report.transcription.parakeet.runtimeInstalled)}`);
      lines.push(`- Parakeet Server State: ${report.transcription.parakeet.serverState}`);
      lines.push(`- Parakeet Active Engine: ${report.transcription.parakeet.activeEngine ?? 'none'}`);
      lines.push(`- Parakeet Cache Directory: ${report.transcription.parakeet.cacheDir}`);
      lines.push(`- Parakeet Cache Present: ${formatBoolean(report.transcription.parakeet.cacheExists)}`);
      for (const engine of report.transcription.parakeet.engines) {
        const detail = engine.lastError ? ` - last error: ${engine.lastError}` : '';
        const status = engine.lastError && !engine.verified
          ? 'latest verification failed'
          : engine.verified
            ? 'verified'
            : report.transcription.parakeet.runtimeInstalled
              ? 'runtime installed, model not yet verified'
              : 'not installed';
        lines.push(`- ${engine.label}: ${status}${detail}`);
        if (engine.lastErrorDetail) {
          lines.push('```text');
          lines.push(engine.lastErrorDetail);
          lines.push('```');
        }
      }
    } else {
      lines.push('- Parakeet: unavailable');
    }
    lines.push('');

    lines.push('### Audio');
    lines.push(`- Priority Mode: ${formatBoolean(report.audio.priorityMode)}`);
    lines.push(`- Priority Device: ${formatOptionalText(report.audio.priorityDeviceName)}`);
    lines.push(`- Current Input: ${formatOptionalText(report.audio.currentDefaultInput)}`);
    lines.push(`- Devices: ${report.audio.devices.filter((device) => device.isInput).length} input, ${report.audio.devices.filter((device) => !device.isInput).length} output`);
    lines.push('');

    lines.push('### Hot Mic');
    lines.push(`- Enabled: ${formatBoolean(report.hotMic.enabled)}`);
    lines.push(`- Muted: ${formatBoolean(report.hotMic.muted)}`);
    lines.push(`- Sounds Enabled: ${formatBoolean(report.hotMic.soundsEnabled)}`);
    lines.push(`- Whisper Fallback: ${formatBoolean(report.hotMic.allowWhisperFallback)}`);
    lines.push(`- Hot Mic Hotkey: ${formatOptionalText(report.hotMic.hotkey)}`);
    lines.push(`- Target App Bundle: ${formatOptionalText(report.hotMic.targetBundleId)}`);
    lines.push(`- Submit Word: ${formatOptionalText(report.hotMic.submitWord)}`);
    lines.push(`- Background Filter: ${formatBoolean(report.hotMic.backgroundFilterEnabled)}`);
    lines.push(`- Background Filter Strength: ${report.hotMic.backgroundFilterStrength ?? 'unset'}`);
    lines.push(`- Drawer Text Size: ${report.hotMic.drawerTextSize ?? 'unset'}`);
    lines.push('');

    lines.push('### Window Management');
    lines.push(`- Enabled: ${formatBoolean(report.windowManagement.enabled)}`);
    lines.push(`- Show in Portable Commands: ${formatBoolean(report.windowManagement.showInCommandLauncher)}`);
    lines.push(`- Focus Height: ${report.windowManagement.focusHeightPercent}%`);
    lines.push(`- Focus Width: ${report.windowManagement.focusWidthPercent}%`);
    lines.push(`- Horizontal Height: ${report.windowManagement.horizontalHeightPercent}%`);
    lines.push(`- Horizontal Keep Height: ${formatBoolean(report.windowManagement.horizontalKeepHeight)}`);
    lines.push(`- Horizontal Hide Others: ${formatBoolean(report.windowManagement.horizontalHideOthers)}`);
    lines.push('');

    lines.push('### Portable Commands');
    lines.push(`- Launcher Hotkey: ${formatOptionalText(report.commands.launcherHotkey)}`);
    lines.push(`- Commands Directory: ${formatOptionalText(report.commands.commandsDirectory)}`);
    lines.push(`- Commands Directory Exists: ${report.commands.commandsDirectoryExists === null ? 'unknown' : formatBoolean(report.commands.commandsDirectoryExists)}`);
    lines.push('');

    lines.push('### Interface & Shortcuts');
    lines.push(`- Transcription Hotkey: ${formatOptionalText(report.interface.transcriptionHotkey)}`);
    lines.push(`- Clipboard History Hotkey: ${formatOptionalText(report.interface.clipboardHistoryHotkey)}`);
    lines.push(`- Screenshot Hotkey: ${formatOptionalText(report.interface.screenshotHotkey)}`);
    lines.push(`- Continuous Context: ${formatBoolean(report.interface.continuousContextEnabled)}`);
    lines.push(`- Continuous Context Hotkey: ${formatOptionalText(report.interface.continuousContextHotkey)}`);
    lines.push(`- Super Paste Hotkey: ${formatOptionalText(report.interface.superPasteHotkey)}`);
    lines.push(`- Sounds Enabled: ${formatBoolean(report.interface.soundsEnabled)}`);
    lines.push(`- Librarian Sound Enabled: ${formatBoolean(report.interface.librarianSoundEnabled)}`);
    lines.push(`- Cursor Status: ${formatBoolean(report.interface.cursorStatusEnabled)}`);
    lines.push(`- Hide Status Labels: ${formatBoolean(report.interface.hideStatusLabels)}`);
    lines.push(`- Show in Dock: ${formatBoolean(report.interface.showInDock)}`);
    lines.push(`- Dark Mode: ${formatBoolean(report.interface.darkMode)}`);
    lines.push(`- Performance HUD: ${formatBoolean(report.interface.performanceHudEnabled)}`);
    lines.push(`- Launch at Login: ${formatBoolean(report.interface.launchAtLogin)}`);
    lines.push(`- Data Retention Days: ${report.interface.dataRetentionDays ?? 'unset'}`);
    lines.push('');

    lines.push('### Support');
    lines.push(`- ${report.support.consoleLogTip}`);

    return lines.join('\n');
  }

  private collectSystemInfo(): DiagnosticsReport['system'] {
    const cpus = os.cpus();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      macOSVersion: os.release(),
      architecture: os.arch(),
      cpuModel: cpus[0]?.model || 'unknown',
      cpuCores: cpus.length,
      totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
      freeMemoryGB: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10,
    };
  }

  private collectAppInfo(): DiagnosticsReport['app'] {
    const { net } = require('electron');

    return {
      userDataPath: app.getPath('userData'),
      onboardingComplete: this.preferencesManager.getPreference('onboardingComplete') ?? false,
      onboardingStep: this.preferencesManager.getPreference('onboardingStep'),
      isPackaged: app.isPackaged,
      networkOnline: net.isOnline(),
    };
  }

  private async collectTranscriptionInfo(): Promise<DiagnosticsReport['transcription']> {
    return {
      selectedEngine: this.transcriberManager?.getConfiguredTranscriptionEngine()
        ?? this.preferencesManager.getPreference('transcriptionEngine')
        ?? 'parakeet',
      engineStatus: this.transcriberManager?.getHotMicEngineStatus() ?? null,
      whisperModels: await this.collectWhisperModels(),
      parakeet: this.transcriberManager?.getParakeetStatus() ?? null,
    };
  }

  private async collectWhisperModels(): Promise<DiagnosticsReport['transcription']['whisperModels']> {
    if (!this.modelManager) {
      return {
        selectedModel: 'unknown',
        modelsDirectory: 'unknown',
        models: [],
        activeDownloads: [],
      };
    }

    const selectedModel = this.modelManager.getSelectedModel();
    const modelsDir = path.join(app.getPath('userData'), 'models');
    const downloadingModels = this.modelManager.getDownloadingModels();

    const models: ModelDiagnostics[] = [];
    for (const size of SUPPORTED_MODEL_SIZES) {
      const modelPath = this.modelManager.getModelPathForSize(size);
      let fileSizeMB: number | null = null;
      let downloaded = false;
      let error: string | undefined;

      try {
        const stats = await fs.stat(modelPath);
        fileSizeMB = Math.round(stats.size / 1024 / 1024 * 10) / 10;
        downloaded = await this.modelManager.isModelAvailableForSize(size);
        if (!downloaded && fileSizeMB > 0) {
          error = 'File exists but failed validation (possibly incomplete)';
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          error = err.message;
        }
      }

      models.push({
        size,
        selected: size === selectedModel,
        downloaded,
        fileSizeMB,
        path: modelPath,
        error,
      });
    }

    return {
      selectedModel,
      modelsDirectory: modelsDir,
      models,
      activeDownloads: downloadingModels,
    };
  }

  private collectAudioInfo(): DiagnosticsReport['audio'] {
    if (!this.audioManager) {
      return {
        priorityMode: false,
        priorityDeviceId: null,
        priorityDeviceName: null,
        currentDefaultInput: null,
        devices: [],
      };
    }

    const state = this.audioManager.getState();
    const rawDevices: unknown[] = Array.isArray(state.devices) ? state.devices : [];
    const devices = rawDevices.filter((device): device is AudioDevice => {
      if (!device || typeof device !== 'object') {
        return false;
      }
      const candidate = device as Partial<AudioDevice>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.isInput === 'boolean' &&
        typeof candidate.isOutput === 'boolean'
      );
    });
    const droppedDevices = rawDevices.length - devices.length;
    if (droppedDevices > 0) {
      log.warn('Diagnostics dropped %d malformed audio device entries', droppedDevices);
    }

    const priorityDevice = devices.find((device) => device.id === state.priorityDeviceId);
    const defaultDevice = devices.find((device) => device.id === state.defaultInputId);

    return {
      priorityMode: state.priorityMode,
      priorityDeviceId: state.priorityDeviceId,
      priorityDeviceName: priorityDevice?.name ?? null,
      currentDefaultInput: defaultDevice?.name ?? null,
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        isInput: device.isInput,
      })),
    };
  }

  private collectHotMicInfo(): DiagnosticsReport['hotMic'] {
    return {
      enabled: this.preferencesManager.getPreference('hotMicEnabled') ?? false,
      muted: this.preferencesManager.getPreference('hotMicMuted') ?? false,
      soundsEnabled: this.preferencesManager.getPreference('hotMicSoundsEnabled') ?? true,
      allowWhisperFallback: false,
      hotkey: this.preferencesManager.getPreference('hotMicHotkey') ?? null,
      targetBundleId: this.preferencesManager.getPreference('hotMicTargetBundleId') ?? null,
      submitWord: this.preferencesManager.getPreference('hotMicSubmitWord') ?? null,
      backgroundFilterEnabled: this.preferencesManager.getPreference('hotMicBackgroundFilterEnabled') ?? false,
      backgroundFilterStrength: this.preferencesManager.getPreference('hotMicBackgroundFilterStrength') ?? null,
      drawerTextSize: this.preferencesManager.getPreference('hotMicDrawerTextSize') ?? null,
    };
  }

  private collectWindowManagementInfo(): DiagnosticsReport['windowManagement'] {
    const rawConfig = this.preferencesManager.getPreference('squaresConfig') as Partial<SquaresConfig> | undefined;
    const config = {
      ...DEFAULT_SQUARES_CONFIG,
      ...(rawConfig ?? {}),
    };

    return {
      enabled: config.enabled,
      showInCommandLauncher: config.showInCommandLauncher,
      focusHeightPercent: config.focusHeightPercent,
      focusWidthPercent: config.focusWidthPercent,
      horizontalHeightPercent: config.horizontalHeightPercent,
      horizontalKeepHeight: config.horizontalKeepHeight,
      horizontalHideOthers: config.horizontalHideOthers,
    };
  }

  private async collectCommandsInfo(): Promise<DiagnosticsReport['commands']> {
    const commandsDirectory = this.preferencesManager.getPreference('commandsDirectory') ?? null;
    let commandsDirectoryExists: boolean | null = null;

    if (commandsDirectory) {
      try {
        const stats = await fs.stat(commandsDirectory);
        commandsDirectoryExists = stats.isDirectory();
      } catch {
        commandsDirectoryExists = false;
      }
    }

    return {
      launcherHotkey: this.preferencesManager.getPreference('commandLauncherHotkey') ?? null,
      commandsDirectory,
      commandsDirectoryExists,
    };
  }

  private collectInterfaceInfo(): DiagnosticsReport['interface'] {
    return {
      transcriptionHotkey: this.preferencesManager.getPreference('transcriptionHotkey') ?? null,
      clipboardHistoryHotkey: this.preferencesManager.getPreference('clipboardHistoryHotkey') ?? null,
      screenshotHotkey: this.preferencesManager.getPreference('clipboardScreenshotHotkey') ?? null,
      continuousContextEnabled: this.preferencesManager.getPreference('continuousContextEnabled') ?? false,
      continuousContextHotkey: this.preferencesManager.getPreference('continuousContextHotkey') ?? null,
      superPasteHotkey: this.preferencesManager.getPreference('superPasteHotkey') ?? null,
      soundsEnabled: this.preferencesManager.getPreference('soundsEnabled') ?? true,
      librarianSoundEnabled: this.preferencesManager.getPreference('librarianSoundEnabled') ?? true,
      cursorStatusEnabled: this.preferencesManager.getPreference('cursorStatusEnabled') ?? false,
      hideStatusLabels: this.preferencesManager.getPreference('hideStatusLabels') ?? false,
      showInDock: this.preferencesManager.getPreference('showInDock') ?? true,
      darkMode: this.preferencesManager.getPreference('darkMode') ?? false,
      performanceHudEnabled: this.preferencesManager.getPreference('performanceHudEnabled') ?? false,
      launchAtLogin: this.preferencesManager.getPreference('launchAtLogin') ?? false,
      dataRetentionDays: this.preferencesManager.getPreference('dataRetentionDays') ?? null,
    };
  }

  private collectIssues(report: DiagnosticsReport): string[] {
    const issues: string[] = [];
    const engineStatus = report.transcription.engineStatus;

    if (engineStatus && engineStatus.readiness !== 'ready' && engineStatus.readiness !== 'cold') {
      issues.push(`Transcription engine ${report.transcription.selectedEngine} is ${engineStatus.readiness}: ${formatOptionalText(engineStatus.detail)}`);
    }

    if (report.transcription.parakeet) {
      for (const engine of report.transcription.parakeet.engines) {
        if (engine.lastError && !engine.verified) {
          issues.push(`${engine.label} failed its latest verification: ${engine.lastError}`);
        }
      }
    }

    if (
      report.commands.commandsDirectory &&
      report.commands.commandsDirectoryExists === false
    ) {
      issues.push(`Portable Commands directory is missing: ${report.commands.commandsDirectory}`);
    }

    if (report.audio.priorityMode && !report.audio.currentDefaultInput) {
      issues.push('Priority microphone mode is enabled but no current input device was resolved');
    }

    return issues;
  }
}

function formatOptionalText(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return 'unset';
  }
  return value;
}

function formatBoolean(value: boolean): string {
  return value ? 'enabled' : 'disabled';
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}
