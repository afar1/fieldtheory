"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const audio_1 = require("./main/types/audio");
const audioAPI = {
    getState: async () => {
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.GET_STATE);
    },
    setPriorityMode: async (enabled) => {
        const payload = { enabled };
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.SET_PRIORITY_MODE, payload);
    },
    setPriorityDevice: async (deviceId) => {
        const payload = { deviceId };
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.SET_PRIORITY_DEVICE, payload);
    },
    resetOverride: async () => {
        return electron_1.ipcRenderer.invoke(audio_1.AudioIPCChannels.RESET_OVERRIDE);
    },
    onStateChanged: (callback) => {
        const handler = (_event, state) => {
            callback(state);
        };
        electron_1.ipcRenderer.on(audio_1.AudioIPCChannels.STATE_CHANGED, handler);
        return () => {
            electron_1.ipcRenderer.removeListener(audio_1.AudioIPCChannels.STATE_CHANGED, handler);
        };
    },
};
electron_1.contextBridge.exposeInMainWorld('audioAPI', audioAPI);
electron_1.contextBridge.exposeInMainWorld('platform', {
    isMacOS: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux',
});
//# sourceMappingURL=preload.js.map