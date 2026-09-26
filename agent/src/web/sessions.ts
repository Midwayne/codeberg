import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { UIMessage } from 'ai';

import { codebergHome } from '../core/paths.js';
import { writeJsonAtomic } from '../core/learning/fs.js';
import { messageSearchHits, type MessageSearchHit } from '../core/session-search.js';

/** One persisted browser chat — UI messages verbatim, so a resume re-renders
 *  with full fidelity (tool cards, reasoning, citations). */
export interface WebSessionRecord {
  id: string;
  /** Derived from the first user message; shown in the sidebar. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  /** Session this one was branched from, when created via Branch. */
  parentId?: string;
  pinned?: boolean;
  archived?: boolean;
}

/** Lightweight row for the sidebar list (no message bodies sent). */
export interface WebSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
  pinned: boolean;
  archived: boolean;
}

export type WebSessionSearchResult = WebSessionSummary & {
  role: MessageSearchHit['role'] | 'title';
  messageId?: string;
  snippet: string;
};

/**
 * Session ids double as filenames and arrive from the client, so constrain them
 * to a safe charset — this is the guard against path traversal on the by-id
 * routes (a `../` id can never reach `join`).
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function home(env: NodeJS.ProcessEnv = process.env): string {
  return codebergHome(env);
}

function countTurns(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * File-backed store of browser chat sessions under `<CODEBERG_HOME>/web-sessions/`,
 * one JSON file per session (`<id>.json`). Read/write failures on an individual
 * file are swallowed where that keeps the UI usable (a corrupt file must not hide
 * the other sessions or break the live chat).
 *
 * Persists the browser's native UI-message format so resume remains lossless.
 */
export class WebSessionStore {
  private readonly dir: string;
  private readonly writes = new Map<string, Promise<void>>();

  constructor(dir?: string) {
    this.dir = dir ?? join(home(), 'web-sessions');
  }

  async save(record: WebSessionRecord): Promise<void> {
    await this.serial(record.id, () => this.write(record));
  }

  /** Message saves preserve metadata even if a pin/archive action overlaps a turn. */
  async upsert(input: Pick<WebSessionRecord, 'id' | 'title' | 'messages'> & { parentId?: string }): Promise<WebSessionRecord> {
    return this.serial(input.id, async () => {
      const existing = await this.load(input.id);
      const now = Date.now();
      const record: WebSessionRecord = {
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(input.parentId || existing?.parentId ? { parentId: input.parentId ?? existing?.parentId } : {}),
        pinned: existing?.pinned === true,
        archived: existing?.archived === true,
      };
      await this.write(record);
      return record;
    });
  }

  async setFlags(id: string, flags: { pinned?: boolean; archived?: boolean }): Promise<WebSessionRecord | null> {
    return this.serial(id, async () => {
      const record = await this.load(id);
      if (!record) return null;
      const updated = { ...record, ...flags };
      await this.write(updated);
      return updated;
    });
  }

  private write(record: WebSessionRecord): Promise<void> {
    return writeJsonAtomic(join(this.dir, `${record.id}.json`), record);
  }

  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.writes.get(id) ?? Promise.resolve();
    const result = prior.catch(() => undefined).then(operation);
    const settled = result.then(() => undefined, () => undefined);
    this.writes.set(id, settled);
    try {
      return await result;
    } finally {
      if (this.writes.get(id) === settled) this.writes.delete(id);
    }
  }

  async load(id: string): Promise<WebSessionRecord | null> {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), 'utf8');
      return JSON.parse(raw) as WebSessionRecord;
    } catch {
      return null;
    }
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list(query = ''): Promise<WebSessionSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const summaries: WebSessionSummary[] = [];
    const needle = query.trim().toLocaleLowerCase();
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const record = await this.load(file.slice(0, -'.json'.length));
      if (record && (!needle || record.title.toLocaleLowerCase().includes(needle) ||
        messageSearchHits(record.messages, needle).length > 0)) {
        summaries.push({
          id: record.id,
          title: record.title,
          updatedAt: record.updatedAt,
          turns: countTurns(record.messages),
          pinned: record.pinned === true,
          archived: record.archived === true,
          ...(record.parentId ? { parentId: record.parentId } : {}),
        });
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Message-level results across active and archived sessions, newest chats first. */
  async search(query: string): Promise<WebSessionSearchResult[]> {
    if (!query.trim()) return [];
    const summaries = await this.list(query);
    const results: WebSessionSearchResult[] = [];
    for (const summary of summaries) {
      const record = await this.load(summary.id);
      if (!record) continue;
      if (record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) {
        results.push({ ...summary, role: 'title', snippet: record.title });
      }
      for (const hit of messageSearchHits(record.messages, query)) {
        results.push({ ...summary, ...hit });
        if (results.length >= 100) break;
      }
      if (results.length >= 100) break;
    }
    return results;
  }

  async remove(id: string): Promise<void> {
    await this.serial(id, async () => {
      try {
        await unlink(join(this.dir, `${id}.json`));
      } catch {
        // already gone / unreadable — nothing to do
      }
    });
  }
}
