import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5580,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5557',
    },
  },
});
