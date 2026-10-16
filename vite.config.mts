// Сборка вкладки диффа (React). Файлы с постоянными именами — их подключает src/diffPanel/html.ts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'webview',
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist/webview'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { webview: resolve(root, 'webview/src/main.tsx') },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
