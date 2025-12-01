import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './', // Use relative paths for assets (required for Electron file:// protocol)
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // Fail if port is already in use
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
        clipboardHistory: path.resolve(__dirname, 'clipboard-history.html'),
      },
    },
  },
});
