import { join } from 'node:path';
import { home } from './records.js';

export class WebSessionStoreState {
  readonly dir: string;

  readonly writes = new Map<string, Promise<void>>();

  constructor(dir?: string) {
    this.dir = dir ?? join(home(), 'web-sessions');
  }
}
