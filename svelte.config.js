import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // Keep TS/script preprocessing, but avoid style preprocessing to prevent
  // intermittent esbuild spawn failures during diagnostics on Windows.
  preprocess: vitePreprocess({ style: false }),
};
