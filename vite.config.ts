/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, rmSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Auto-discover built-in Three.js / p5.js animations from public/threejs/.
// Each subdirectory containing an index.html becomes a bundled tray item.
// Drop a folder in and the next build picks it up — no config to update.
// Exposed via the virtual module `virtual:threejs-bundles` so the renderer
// can import a literal list at build time (works in dev + prod).
function threejsBundlesPlugin(): Plugin {
  const virtualId = 'virtual:threejs-bundles';
  const resolvedId = '\0' + virtualId;
  let assetBase = './';
  const scan = () => {
    const dir = resolve(__dirname, 'public/threejs');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(name => {
      try {
        const p = resolve(dir, name);
        return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
      } catch { return false; }
    });
  };
  return {
    name: 'ghost-arcade-threejs-bundles',
    configResolved(config) { assetBase = config.base; },
    resolveId(id) { if (id === virtualId) return resolvedId; return null; },
    load(id) {
      if (id !== resolvedId) return null;
      const names = scan();
      const dir = resolve(__dirname, 'public/threejs');
      // Capitalize folder name for the display label; underscores/hyphens
      // become spaces so 'paint_drip' renders as 'Paint Drip'.
      const items = names.map(name => ({
        id: `builtin-threejs-${name}`,
        folder: name,
        name: name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        url: `${assetBase}threejs/${encodeURIComponent(name)}/index.html`,
        // A thumb.jpg beside the page is shown in the JS tab at once.
        thumbnail: existsSync(resolve(dir, name, 'thumb.jpg')) ? `${assetBase}threejs/${encodeURIComponent(name)}/thumb.jpg` : undefined,
      }));
      return `export default ${JSON.stringify(items, null, 2)};`;
    },
    // Re-scan on dev when a new file appears under public/threejs/. Vite
    // automatically serves /public/ at the root in dev, so this only
    // refreshes the virtual import — the file itself is already live.
    handleHotUpdate(ctx) {
      if (ctx.file.replace(/\\/g, '/').includes('/public/threejs/')) {
        const mod = ctx.server.moduleGraph.getModuleById(resolvedId);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
      return undefined;
    },
  };
}

// The loading screen in index.html is plain markup so it paints before any
// script has loaded. Its wordmark is inlined here from the same file the
// welcome screen imports, so the two can never drift apart.
function wordmarkPlugin(): Plugin {
  const file = resolve(__dirname, 'src/lib/brand/wordmark.svg');
  return {
    name: 'ghost-arcade-wordmark',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('<!-- wordmark -->', readFileSync(file, 'utf-8').trim()),
    },
  };
}

/** Shader files that belong to the Music Studio: its visual voices (VX-),
 *  note-reactive visuals (NR-) and its glitch set (BG-). */
export const STUDIO_SHADER = /^(VX|NR|BG)-.*\.fs$/;

// A build without the Music Studio (VITE_MUSIC_STUDIO=off, as releases are
// built) leaves out its paid content too: its shaders, their thumbnails and
// their entries in the shader manifest, so they never reach the library.
function studioContentPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'ghost-arcade-studio-content',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      if ((process.env.VITE_MUSIC_STUDIO ?? 'on') !== 'off') return;
      const isf = resolve(outDir, 'ISF');
      if (!existsSync(isf)) return;
      for (const name of readdirSync(isf)) if (STUDIO_SHADER.test(name)) rmSync(resolve(isf, name));
      rmSync(resolve(isf, 'voice-thumbs'), { recursive: true, force: true });
      const manifestPath = resolve(isf, 'manifest.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.shaders = (manifest.shaders ?? []).filter((s: { file?: string }) => !STUDIO_SHADER.test(String(s.file ?? '')));
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    },
  };
}

export default defineConfig({
  plugins: [svelte(), threejsBundlesPlugin(), wordmarkPlugin(), studioContentPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Bridge for legacy CJS deps that reference Node's `global` (e.g.
    // raf, used transitively by hydra-synth → raf-loop → raf). Vite's
    // strict-ESM wrap leaves the bare identifier unresolved, throwing
    // "ReferenceError: global is not defined" at module load. Vite's
    // `define` substitution only replaces standalone identifiers, so
    // `obj.global` style accesses are unaffected.
    global: 'globalThis',
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
      // Native builds and isolated Electron profiles change continuously during playback.
      ignored: ['**/src-tauri/**', '**/native-renderer/target/**', '**/scratchpad/**', '**/reports/**', '**/*.log'],
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
    // The sketch editor is loaded on first use. Bundling its editor packages
    // up front stops the dev server from reloading the page (and dropping an
    // unsaved project) the first time it opens.
    include: [
      'codemirror',
      '@codemirror/commands',
      '@codemirror/lang-css',
      '@codemirror/lang-html',
      '@codemirror/lang-javascript',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/merge',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/highlight',
      '@lezer/javascript',
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Several suites import the whole sync/layer graph or wait on real
    // timers. Vitest's 5 s / 10 s defaults pass on an idle machine and fail
    // whenever it is busy (a parallel build, a slower CI runner), on every
    // platform. These leave room without hiding a genuinely hung test.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
