import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import appConfig from '../vite.config';

export default mergeConfig(appConfig, {
  build: {
    outDir: 'node_modules/.cache/typing-bench',
    rolldownOptions: { input: ['index.html', 'switching.html', 'cancel-activation.html']
      .map((path) => fileURLToPath(new URL(path, import.meta.url))) },
  },
});
