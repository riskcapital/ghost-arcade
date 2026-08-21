/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Auto-discover built-in Three.js / p5.js animations from public/threejs/.
// Each subdirectory containing an index.html becomes a bundled tray item.
// Drop a folder in and the next build picks it up — no config to update.
// Exposed via the virtual module `virtual:threejs-bundles` so the renderer
// can import a literal list at build time (works in dev + prod).
function threejsBundlesPlugin(): Plugin {
  const virtualId = 'virtual:threejs-bundles';
  const resolvedId = '\0' + virtualId;
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
    resolveId(id) { if (id === virtualId) return resolvedId; return null; },
    load(id) {
      if (id !== resolvedId) return null;
      const names = scan();
      // Capitalize folder name for the display label; underscores/hyphens
      // become spaces so 'paint_drip' renders as 'Paint Drip'.
      const items = names.map(name => ({
        id: `builtin-threejs-${name}`,
        folder: name,
        name: name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        url: `threejs/${name}/index.html`,
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

export default defineConfig({
  plugins: [svelte(), threejsBundlesPlugin()],
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
