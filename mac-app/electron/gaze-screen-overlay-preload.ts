import { contextBridge, ipcRenderer } from 'electron';

const GazeIPCChannels = {
  GET_STATUS: 'gaze:getStatus',
  GET_LATEST_SAMPLE: 'gaze:getLatestSample',
} as const;

type GazeScreenOverlaySnapshot = {
  point: { x: number; y: number } | null;
  confidence: number;
  windowBounds: { x: number; y: number; width: number; height: number };
  status: {
    enabled: boolean;
    running: boolean;
    cameraAuthorized: boolean;
    targetFps: number;
    reason: string | null;
    lastSampleAtMs: number | null;
  };
  updatedAtMs: number;
};

contextBridge.exposeInMainWorld('gazeScreenOverlayAPI', {
  onSnapshot: (callback: (snapshot: GazeScreenOverlaySnapshot) => void) => {
    ipcRenderer.on('gaze-screen-overlay:snapshot', (_event, snapshot: GazeScreenOverlaySnapshot) => {
      callback(snapshot);
    });
  },
  getSnapshot: async (): Promise<GazeScreenOverlaySnapshot | null> => {
    try {
      const [status, sample] = await Promise.all([
        ipcRenderer.invoke(GazeIPCChannels.GET_STATUS),
        ipcRenderer.invoke(GazeIPCChannels.GET_LATEST_SAMPLE),
      ]);
      return {
        point: sample?.mappedScreenPoint ?? null,
        confidence: sample?.confidence ?? 0,
        windowBounds: { x: 0, y: 0, width: 1, height: 1 },
        status,
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

ipcRenderer.send('gaze-screen-overlay:preloadReady', {
  timestampMs: Date.now(),
});
