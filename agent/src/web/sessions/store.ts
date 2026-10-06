import { remove, removeOlder } from './deletion.js';
import { list, load, search } from './reading.js';
import type { WebSessionRecord, WebSessionSearchResult, WebSessionSummary } from './records.js';
import { WebSessionStoreState } from './state.js';
import { save, setFlags, upsert } from './writing.js';

/**
 * File-backed store of browser chat sessions under `<CODEBERG_HOME>/web-sessions/`,
 * one JSON file per session (`<id>.json`). Read/write failures on an individual
 * file are swallowed where that keeps the UI usable (a corrupt file must not hide
 * the other sessions or break the live chat).
 *
 * Persists the browser's native UI-message format so resume remains lossless.
 */
export class WebSessionStore {
  private readonly state: WebSessionStoreState;

  constructor(dir?: string) {
    this.state = new WebSessionStoreState(dir);
  }

  get dir(): string {
    return this.state.dir;
  }

  save(record: WebSessionRecord): Promise<void> {
    return save(this.state, record);
  }

  /** Message saves preserve metadata even if a pin/archive action overlaps a turn. */
  upsert(
    input: Pick<WebSessionRecord, 'id' | 'title' | 'messages'> & { parentId?: string },
  ): Promise<WebSessionRecord> {
    return upsert(this.state, input);
  }

  setFlags(
    id: string,
    flags: { pinned?: boolean; archived?: boolean },
  ): Promise<WebSessionRecord | null> {
    return setFlags(this.state, id, flags);
  }

  load(id: string): Promise<WebSessionRecord | null> {
    return load(this.state, id);
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  list(query = ''): Promise<WebSessionSummary[]> {
    return list(this.state, query);
  }

  /** Message-level results across active and archived sessions, newest chats first. */
  search(query: string): Promise<WebSessionSearchResult[]> {
    return search(this.state, query);
  }

  remove(id: string): Promise<void> {
    return remove(this.state, id);
  }

  /** Recheck age and pins inside the same serialization used by saves. */
  removeOlder(id: string, cutoff: number): Promise<number | undefined> {
    return removeOlder(this.state, id, cutoff);
  }
}

export type { WebSessionRecord, WebSessionSearchResult, WebSessionSummary } from './records.js';

export { isValidSessionId } from './records.js';
