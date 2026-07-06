import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '$lib': resolve(__dirname, 'src/lib'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/lib/renderer/**/*.native.test.ts', 'tests/native/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 10000,
  },
});
