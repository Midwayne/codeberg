import { join } from 'node:path';
import { codebergDataHome } from '../../core/paths.js';

export class WebSessionStoreState {
  readonly dir: string;

  readonly writes = new Map<string, Promise<void>>();

  constructor(dir?: string) {
    this.dir = dir ?? join(codebergDataHome(), 'web-sessions');
  }
}
