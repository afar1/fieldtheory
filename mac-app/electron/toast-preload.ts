import { contextBridge, ipcRenderer } from 'electron';

/**
 * Toast window preload script.
 * Exposes a simple API for the toast to communicate click events.
 */
contextBridge.exposeInMainWorld('toastAPI', {
  clicked: () => {
    ipcRenderer.send('toast-clicked');
  },
  hoverStart: () => {
    ipcRenderer.send('toast-hover-start');
  },
  hoverEnd: () => {
    ipcRenderer.send('toast-hover-end');
  },
});
