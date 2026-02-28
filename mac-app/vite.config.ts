import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env vars from .env.local (and .env, .env.[mode], etc.)
  // The third param '' means load all env vars, not just VITE_ prefixed ones.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    base: './', // Use relative paths for assets (required for Electron file:// protocol)
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true, // Fail if port is already in use
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          overlay: path.resolve(__dirname, 'overlay.html'),
          clipboardHistory: path.resolve(__dirname, 'clipboard-history.html'),
          cursorStatus: path.resolve(__dirname, 'cursor-status.html'),
          commandLauncher: path.resolve(__dirname, 'command-launcher.html'),
          dynamicIsland: path.resolve(__dirname, 'dynamic-island.html'),
        },
      },
    },
    // Bake Supabase credentials into the production bundle at build time.
    // Without this, import.meta.env.VITE_* is undefined in production builds.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
    },
  };
});
