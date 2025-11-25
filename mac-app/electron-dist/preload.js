"use strict";
// =============================================================================
// Preload Script - Secure IPC bridge between Electron main and renderer.
// Exposes a type-safe API for audio state management via contextBridge.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const audio_1 = require("./main/types/audio");
// Create the audio API implementation.
const audioAPI = {
    /**
     * Get the current audio state from the main process.
     */
    getState: async () => {
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.GET_STATE);
    },
    /**
     * Set whether priority mode is enabled.
     */
    setPriorityMode: async (enabled) => {
        const payload = { enabled };
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.SET_PRIORITY_MODE, payload);
    },
    /**
     * Set which device should be prioritized.
     */
    setPriorityDevice: async (deviceId) => {
        const payload = { deviceId };
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.SET_PRIORITY_DEVICE, payload);
    },
    /**
     * Reset any user override and re-enforce priority if enabled.
     */
    resetOverride: async () => {
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.RESET_OVERRIDE);
    },
    /**
     * Subscribe to audio state changes.
     * The callback will be called whenever the audio state updates.
     * Returns an unsubscribe function.
     */
    onStateChanged: (callback) => {
        const handler = (_event, state) => {
            callback(state);
        };
        electron_1.ipcRenderer.on(audio_1.AudioIPCChannels.STATE_CHANGED, handler);
        // Return unsubscribe function.
        return () => {
            electron_1.ipcRenderer.removeListener(audio_1.AudioIPCChannels.STATE_CHANGED, handler);
        };
    },
};
// Expose the API to the renderer process via contextBridge.
// This makes `window.audioAPI` available in the renderer.
electron_1.contextBridge.exposeInMainWorld('audioAPI', audioAPI);
// Also expose a minimal platform info object.
electron_1.contextBridge.exposeInMainWorld('platform', {
    isMacOS: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux',
});
//# sourceMappingURL=preload.js.map