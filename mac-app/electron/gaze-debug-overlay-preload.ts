import { contextBridge, ipcRenderer } from 'electron';

const GazeIPCChannels = {
  GET_STATUS: 'gaze:getStatus',
  GET_LATEST_SAMPLE: 'gaze:getLatestSample',
  GET_CALIBRATION_STATE: 'gaze:getCalibrationState',
} as const;

type GazeDebugOverlaySnapshot = {
  status: {
    enabled: boolean;
    running: boolean;
    cameraAuthorized: boolean;
    targetFps: number;
    reason: string | null;
    lastSampleAtMs: number | null;
  };
  calibration: {
    active: boolean;
    stableForMs: number;
    manualCorrectionCount: number;
    lastCalibratedAtMs: number | null;
    needsRecalibrationPrompt: boolean;
    recalibrationReason: string | null;
  };
  sample: {
    timestampMs: number;
    confidence: number;
    combinedEye: { x: number; y: number };
    calibratedCombinedEye: { x: number; y: number };
    calibrationApplied: boolean;
    headPose: { yaw: number; pitch: number; roll: number };
    gazeVector: { x: number; y: number; z: number };
    faceBounds: { x: number; y: number; width: number; height: number };
    faceSize: number;
    distanceScale: number;
    activeDisplayId?: number | null;
    landmarks?: {
      leftEye: {
        medialCanthus: { x: number; y: number };
        lateralCanthus: { x: number; y: number };
        irisCenter: { x: number; y: number };
      };
      rightEye: {
        medialCanthus: { x: number; y: number };
        lateralCanthus: { x: number; y: number };
        irisCenter: { x: number; y: number };
      };
    } | null;
  } | null;
  updatedAtMs: number;
};

contextBridge.exposeInMainWorld('gazeDebugOverlayAPI', {
  onSnapshot: (callback: (snapshot: GazeDebugOverlaySnapshot) => void) => {
    ipcRenderer.on('gaze-debug-overlay:snapshot', (_event, snapshot: GazeDebugOverlaySnapshot) => {
      callback(snapshot);
    });
  },
  getSnapshot: async (): Promise<GazeDebugOverlaySnapshot | null> => {
    try {
      const [status, calibration, sample] = await Promise.all([
        ipcRenderer.invoke(GazeIPCChannels.GET_STATUS),
        ipcRenderer.invoke(GazeIPCChannels.GET_CALIBRATION_STATE),
        ipcRenderer.invoke(GazeIPCChannels.GET_LATEST_SAMPLE),
      ]);

      return {
        status,
        calibration,
        sample,
        updatedAtMs: Date.now(),
      };
    } catch {
      return null;
    }
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});

ipcRenderer.send('gaze-debug-overlay:preloadReady', {
  timestampMs: Date.now(),
});
