import { join } from 'node:path';
import { envFlag } from '../env.js';
import { codebergDataHome } from '../paths.js';
import { CanvasStore } from './store.js';

export function canvasFromEnv(env: NodeJS.ProcessEnv): CanvasStore {
  const url = new URL('/canvas', `http://127.0.0.1:${env.CODEBERG_WEB_PORT ?? env.PORT ?? '48088'}`);
  if (env.CODEBERG_PROJECT_ID) url.searchParams.set('project', env.CODEBERG_PROJECT_ID);

  return new CanvasStore(join(codebergDataHome(env), 'canvas'), url.href,
    envFlag(env, 'CODEBERG_CANVAS_USE', false));
}
