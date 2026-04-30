import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: [
      'src/**/*.test.{ts,tsx}',
      'electron/main/**/*.test.ts',
      'electron/shared/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/electron-dist/**',
      '**/*.test.cjs',
      '**/*.spec.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'electron-dist/**',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
});
