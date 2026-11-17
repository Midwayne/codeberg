import { join } from 'node:path';
import { home, type WebSessionSummary } from './records.js';

/** A chat's sidebar row, valid while its file keeps this identity. */
export type CachedSummary = { version: string; summary: WebSessionSummary };

export class WebSessionStoreState {
  readonly dir: string;

  readonly writes = new Map<string, Promise<void>>();

  /** Sidebar rows by chat id; a changed file (inode, size or mtime) is re-read. */
  readonly summaries = new Map<string, CachedSummary>();

  constructor(dir?: string) {
    this.dir = dir ?? join(home(), 'web-sessions');
  }
}
