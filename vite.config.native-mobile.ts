/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));

export default defineConfig({
  root: rootDir,
  publicDir: resolve(rootDir, 'public'),
  plugins: [
    svelte(),
    {
      name: 'ghost-native-mobile-index',
      writeBundle() {
        const source = resolve(rootDir, 'dist-native-mobile/native-mobile.html');
        const target = resolve(rootDir, 'dist-native-mobile/index.html');
        if (existsSync(source)) copyFileSync(source, target);
        // These desktop assets explicitly prohibit commercial redistribution.
        const excluded: string[] = JSON.parse(readFileSync(resolve(rootDir, 'native-mobile/release-exclusions.json'), 'utf8'));
        for (const path of excluded) {
          rmSync(resolve(rootDir, 'dist-native-mobile', path), { force: true });
          rmSync(resolve(rootDir, 'dist-native-mobile/ISF/thumbnails', path.slice(4, -3).replaceAll('/', '_') + '.jpg'), { force: true });
        }
      },
    },
  ],
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
    // The app's minimum is iOS 16.0. 'esnext' left class static blocks in
    // the three.js chunk, which Safari only understands from 16.4, so that
    // chunk could not load on 16.0–16.3.
    target: 'safari16',
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
