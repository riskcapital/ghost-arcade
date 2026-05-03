/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './', // Relative paths for Electron file:// protocol
  clearScreen: false,
  resolve: {
    alias: {
      '$lib': resolve(__dirname, 'src/lib'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: true, // Listen on all network interfaces for mobile access
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // Required headers for FFmpeg.wasm (SharedArrayBuffer support)
    // Note: Using 'credentialless' instead of 'require-corp' for COEP
    // to allow mobile devices to access the app while still enabling SharedArrayBuffer
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        output: resolve(__dirname, 'output.html'),
      },
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
