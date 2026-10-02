import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import appConfig from '../vite.config';

export default mergeConfig(appConfig, {
  build: {
    outDir: 'node_modules/.cache/typing-bench',
    rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
});
