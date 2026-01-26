import { app } from 'electron';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { PreferencesManager } from './preferences';
import { ModelManager, ModelSize } from './modelManager';
import { AudioManager } from './audioManager';

/**
 * Diagnostic information about a Whisper model.
 */
interface ModelDiagnostics {
  size: string;
  selected: boolean;
  downloaded: boolean;
  fileSizeMB: number | null;
  path: string;
  error?: string;
}

/**
 * Full diagnostics report for troubleshooting.
 * Designed to be shared with support for remote debugging.
 */
export interface DiagnosticsReport {
  timestamp: string;
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
  whisperModels: {
    selectedModel: string;
    modelsDirectory: string;
    models: ModelDiagnostics[];
    activeDownloads: string[];
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
  preferences: {
    transcriptionHotkey: string;
    soundsEnabled: boolean;
    showInDock: boolean;
    cursorStatusEnabled: boolean;
  };
  support: {
    consoleLogTip: string;
  };
}

/**
 * Collects diagnostic information from all app components.
 * Used for remote troubleshooting without requiring user to dig through logs.
 */
export class DiagnosticsCollector {
  private preferencesManager: PreferencesManager;
  private modelManager: ModelManager | null = null;
  private audioManager: AudioManager | null = null;

  constructor(preferencesManager: PreferencesManager) {
    this.preferencesManager = preferencesManager;
  }

  /**
   * Set the model manager for Whisper model diagnostics.
   */
  setModelManager(modelManager: ModelManager): void {
    this.modelManager = modelManager;
  }

  /**
   * Set the audio manager for audio device diagnostics.
   */
  setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager;
  }

  /**
   * Collect all diagnostic information.
   */
  async collect(): Promise<DiagnosticsReport> {
    const whisperModels = await this.collectWhisperModels();

    return {
      timestamp: new Date().toISOString(),
      system: this.collectSystemInfo(),
      app: this.collectAppInfo(),
      whisperModels,
      audio: this.collectAudioInfo(),
      preferences: this.collectPreferences(),
      support: {
        consoleLogTip: 'For detailed error logs, open Console.app and filter by "Field Theory"',
      },
    };
  }

  /**
   * Format diagnostics as readable markdown for sharing.
   */
  formatAsMarkdown(report: DiagnosticsReport): string {
    const lines: string[] = [
      '## Field Theory Diagnostics',
      `Generated: ${report.timestamp}`,
      '',
      '### System',
      `- App Version: ${report.system.appVersion}`,
      `- macOS: ${report.system.macOSVersion}`,
      `- Architecture: ${report.system.architecture}`,
      `- CPU: ${report.system.cpuModel} (${report.system.cpuCores} cores)`,
      `- Memory: ${report.system.totalMemoryGB} GB total, ${report.system.freeMemoryGB} GB free`,
      `- Electron: ${report.system.electronVersion}`,
      '',
      '### App State',
      `- Onboarding Complete: ${report.app.onboardingComplete}`,
      `- Onboarding Step: ${report.app.onboardingStep ?? 'N/A'}`,
      `- Network: ${report.app.networkOnline ? 'online' : 'offline'}`,
      `- Packaged: ${report.app.isPackaged}`,
      `- User Data: ${report.app.userDataPath}`,
      '',
      '### Whisper Models',
      `- Selected: ${report.whisperModels.selectedModel}`,
      `- Directory: ${report.whisperModels.modelsDirectory}`,
      `- Active Downloads: ${report.whisperModels.activeDownloads.length > 0 ? report.whisperModels.activeDownloads.join(', ') : 'none'}`,
    ];

    for (const model of report.whisperModels.models) {
      const status = model.downloaded
        ? `downloaded (${model.fileSizeMB?.toFixed(1)} MB)`
        : 'not downloaded';
      const selected = model.selected ? ' [SELECTED]' : '';
      const error = model.error ? ` - ERROR: ${model.error}` : '';
      lines.push(`- ${model.size}: ${status}${selected}${error}`);
    }

    lines.push('');
    lines.push('### Audio');
    lines.push(`- Priority Mode: ${report.audio.priorityMode ? 'enabled' : 'disabled'}`);
    lines.push(`- Priority Device: ${report.audio.priorityDeviceName ?? 'none'}`);
    lines.push(`- Current Input: ${report.audio.currentDefaultInput ?? 'unknown'}`);
    lines.push(`- Devices: ${report.audio.devices.filter(d => d.isInput).length} input, ${report.audio.devices.filter(d => !d.isInput).length} output`);

    lines.push('');
    lines.push('### Preferences');
    lines.push(`- Transcription Hotkey: ${report.preferences.transcriptionHotkey}`);
    lines.push(`- Sounds Enabled: ${report.preferences.soundsEnabled}`);
    lines.push(`- Show in Dock: ${report.preferences.showInDock}`);
    lines.push(`- Cursor Status: ${report.preferences.cursorStatusEnabled}`);

    lines.push('');
    lines.push('### Support');
    lines.push(`- ${report.support.consoleLogTip}`);

    return lines.join('\n');
  }

  // --- Private collection methods ---

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
    // Import net here to check online status.
    const { net } = require('electron');
    
    return {
      userDataPath: app.getPath('userData'),
      onboardingComplete: this.preferencesManager.getPreference('onboardingComplete') ?? false,
      onboardingStep: this.preferencesManager.getPreference('onboardingStep'),
      isPackaged: app.isPackaged,
      networkOnline: net.isOnline(),
    };
  }

  private async collectWhisperModels(): Promise<DiagnosticsReport['whisperModels']> {
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
    const availableModels = this.modelManager.getAvailableModels();
    const downloadingModels = this.modelManager.getDownloadingModels();

    const models: ModelDiagnostics[] = [];
    for (const size of ['small', 'medium'] as ModelSize[]) {
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
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          error = e.message;
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
    const priorityDevice = state.devices.find(d => d.id === state.priorityDeviceId);
    const defaultDevice = state.devices.find(d => d.id === state.defaultInputId);

    return {
      priorityMode: state.priorityMode,
      priorityDeviceId: state.priorityDeviceId,
      priorityDeviceName: priorityDevice?.name ?? null,
      currentDefaultInput: defaultDevice?.name ?? null,
      devices: state.devices.map(d => ({
        id: d.id,
        name: d.name,
        isInput: d.isInput,
      })),
    };
  }

  private collectPreferences(): DiagnosticsReport['preferences'] {
    return {
      transcriptionHotkey: this.preferencesManager.getPreference('transcriptionHotkey'),
      soundsEnabled: this.preferencesManager.getPreference('soundsEnabled') ?? true,
      showInDock: this.preferencesManager.getPreference('showInDock') ?? true,
      cursorStatusEnabled: this.preferencesManager.getPreference('cursorStatusEnabled') ?? false,
    };
  }
}
