import { app, BrowserWindow, screen } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { PreferencesManager } from '../preferences';
import { GazeSample, GazeScreenOverlayState, GazeTrackingStatus, createUnavailableGazeStatus } from '../types/gaze';

const log = createLogger('GazeScreenOverlay');
const OVERLAY_CHANNEL = 'gaze-screen-overlay:snapshot';
const OVERLAY_FPS = 30;
const OVERLAY_FRAME_INTERVAL_MS = Math.round(1000 / OVERLAY_FPS);

type OverlaySnapshotPayload = {
  point: { x: number; y: number } | null;
  confidence: number;
  windowBounds: { x: number; y: number; width: number; height: number };
  status: GazeTrackingStatus;
  updatedAtMs: number;
};

export class GazeScreenOverlayManager extends EventEmitter {
  private readonly preferences: PreferencesManager;
  private window: BrowserWindow | null = null;
  private enabled = false;
  private rendererReady = false;
  private sendTimer: NodeJS.Timeout | null = null;
  private lastSentAtMs = 0;
  private latestPoint: { x: number; y: number } | null = null;
  private latestConfidence = 0;
  private latestStatus: GazeTrackingStatus = createUnavailableGazeStatus();
  private screenListenersAttached = false;

  constructor(preferences: PreferencesManager) {
    super();
    this.preferences = preferences;
    this.enabled = this.preferences.getPreference('gazeScreenOverlayEnabled') === true;
  }

  async initFromPreferences(): Promise<void> {
    const shouldEnable = this.preferences.getPreference('gazeScreenOverlayEnabled') === true;
    await this.setEnabled(shouldEnable, false);
  }

  async reloadFromPreferences(): Promise<void> {
    const shouldEnable = this.preferences.getPreference('gazeScreenOverlayEnabled') === true;
    await this.setEnabled(shouldEnable, false);
  }

  getState(): GazeScreenOverlayState {
    return {
      enabled: this.enabled,
      visible: !!this.window && !this.window.isDestroyed() && this.window.isVisible(),
    };
  }

  async setEnabled(enabled: boolean, persist: boolean = true): Promise<GazeScreenOverlayState> {
    const nextEnabled = enabled === true;
    if (nextEnabled === this.enabled) {
      if (nextEnabled && (!this.window || this.window.isDestroyed())) {
        this.createWindow();
      }
      return this.getState();
    }

    this.enabled = nextEnabled;
    log.info('Screen overlay %s', this.enabled ? 'enabled' : 'disabled');
    if (this.enabled) {
      this.createWindow();
    } else {
      this.closeWindow();
    }

    if (persist) {
      try {
        await this.preferences.save({
          gazeScreenOverlayEnabled: this.enabled,
        });
      } catch (error) {
        log.warn('Failed to persist screen overlay state:', error);
      }
    }

    const snapshot = this.getState();
    this.emit('stateChanged', snapshot);
    return snapshot;
  }

  updateStatus(status: GazeTrackingStatus): void {
    this.latestStatus = cloneStatus(status);
    if (!status.running) {
      this.latestPoint = null;
      this.latestConfidence = 0;
    }
    this.scheduleSend();
  }

  updateSample(sample: GazeSample): void {
    this.latestConfidence = sample.confidence;
    this.latestPoint = sample.mappedScreenPoint
      ? { x: sample.mappedScreenPoint.x, y: sample.mappedScreenPoint.y }
      : null;
    this.scheduleSend();
  }

  destroy(): void {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    this.detachScreenListeners();
    this.closeWindow();
    this.removeAllListeners();
  }

  private createWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      return;
    }

    this.rendererReady = false;
    const bounds = getVirtualDesktopBounds();
    const preloadPath = resolveScreenOverlayPreloadPath();
    if (!fs.existsSync(preloadPath)) {
      log.error('Screen overlay preload script missing: %s', preloadPath);
    } else {
      log.info('Screen overlay preload script: %s', preloadPath);
    }

    this.window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      focusable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(true, { forward: true });

    this.window.webContents.on('ipc-message', (_event, channel, ...args) => {
      if (channel === 'gaze-screen-overlay:preloadReady') {
        log.info('Screen overlay preload ready: %s', JSON.stringify(args[0] ?? {}));
      }
    });

    this.window.on('closed', () => {
      this.window = null;
      this.rendererReady = false;
      if (this.enabled) {
        this.enabled = false;
        this.preferences.save({
          gazeScreenOverlayEnabled: false,
        }).catch((error) => {
          log.warn('Failed to persist screen overlay closed state:', error);
        });
      }
      this.emit('stateChanged', this.getState());
    });

    this.window.webContents.once('did-finish-load', () => {
      this.rendererReady = true;
      this.sendSnapshotNow();
      this.window?.showInactive();
      this.emit('stateChanged', this.getState());
    });

    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      log.error('Failed to load gaze screen overlay window: %s %s', errorCode, errorDescription);
    });

    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      this.window.loadURL(appendPathToBaseUrl(startUrl, 'gaze-screen-overlay.html'));
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'gaze-screen-overlay.html');
      this.window.loadFile(htmlPath);
    }

    this.attachScreenListeners();
  }

  private closeWindow(): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.close();
    this.window = null;
    this.rendererReady = false;
    this.detachScreenListeners();
  }

  private scheduleSend(): void {
    if (!this.enabled || !this.window || this.window.isDestroyed() || !this.rendererReady) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastSentAtMs;
    if (elapsed >= OVERLAY_FRAME_INTERVAL_MS) {
      this.sendSnapshotNow();
      return;
    }

    if (this.sendTimer) {
      return;
    }

    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.sendSnapshotNow();
    }, OVERLAY_FRAME_INTERVAL_MS - elapsed);
  }

  private sendSnapshotNow(): void {
    if (!this.window || this.window.isDestroyed() || !this.rendererReady) {
      return;
    }
    this.lastSentAtMs = Date.now();

    const bounds = this.window.getBounds();
    const payload: OverlaySnapshotPayload = {
      point: this.latestPoint ? { ...this.latestPoint } : null,
      confidence: this.latestConfidence,
      windowBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      status: cloneStatus(this.latestStatus),
      updatedAtMs: Date.now(),
    };

    this.window.webContents.send(OVERLAY_CHANNEL, payload);
  }

  private attachScreenListeners(): void {
    if (this.screenListenersAttached) {
      return;
    }
    this.screenListenersAttached = true;
    screen.on('display-added', this.handleDisplayChange);
    screen.on('display-removed', this.handleDisplayChange);
    screen.on('display-metrics-changed', this.handleDisplayChange);
  }

  private detachScreenListeners(): void {
    if (!this.screenListenersAttached) {
      return;
    }
    this.screenListenersAttached = false;
    screen.removeListener('display-added', this.handleDisplayChange);
    screen.removeListener('display-removed', this.handleDisplayChange);
    screen.removeListener('display-metrics-changed', this.handleDisplayChange);
  }

  private readonly handleDisplayChange = () => {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    const bounds = getVirtualDesktopBounds();
    this.window.setBounds(bounds, false);
    this.sendSnapshotNow();
  };
}

function getVirtualDesktopBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) {
    const primary = screen.getPrimaryDisplay().bounds;
    return {
      x: primary.x,
      y: primary.y,
      width: primary.width,
      height: primary.height,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function cloneStatus(status: GazeTrackingStatus): GazeTrackingStatus {
  return {
    enabled: status.enabled,
    running: status.running,
    cameraAuthorized: status.cameraAuthorized,
    targetFps: status.targetFps,
    reason: status.reason,
    lastSampleAtMs: status.lastSampleAtMs,
  };
}

function appendPathToBaseUrl(baseUrl: string, page: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${page}`;
  }
  return `${baseUrl}/${page}`;
}

function resolveScreenOverlayPreloadPath(): string {
  return path.resolve(__dirname, '../../gaze-screen-overlay-preload.js');
}
