/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));

export default defineConfig({
  root: rootDir,
  publicDir: resolve(rootDir, 'public'),
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    global: 'globalThis',
  },
  base: './',
  clearScreen: false,
  resolve: {
    alias: {
      '$lib': resolve(rootDir, 'src/lib'),
    },
  },
  server: {
    port: 1421,
    strictPort: true,
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    outDir: resolve(rootDir, 'dist-native-mobile'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        nativeMobile: resolve(rootDir, 'native-mobile.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
