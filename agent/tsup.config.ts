import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/main.ts',
    'search-cli': 'src/cli/search-main.ts',
    tui: 'src/tui/main.ts',
    web: 'src/web/main.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: ['ai', '@ai-sdk/tui', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google'],
  splitting: false,
});
