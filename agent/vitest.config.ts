import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@agent/core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'web-ui/src/**/*.test.ts'],
  },
});
