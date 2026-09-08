import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', build: { outDir: '/tmp/fieldtheory-drawesome-preview', emptyOutDir: true, rollupOptions: { input: 'drawing-prototype.html' } } });
