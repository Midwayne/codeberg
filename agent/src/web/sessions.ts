import { join } from 'node:path';

import type { UIMessage } from 'ai';

import { countUserTurns, JsonDirectory } from '../core/json-directory.js';
import { codebergHome } from '../core/paths.js';

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
}

/** Lightweight row for the sidebar list (no message bodies sent). */
export interface WebSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
}

/**
 * Session ids double as filenames and arrive from the client, so constrain them
 * to a safe charset — this is the guard against path traversal on the by-id
 * routes (a `../` id can never reach `join`).
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * File-backed store of browser chat sessions under `<CODEBERG_HOME>/web-sessions/`,
 * one JSON file per session (`<id>.json`). Read/write failures on an individual
 * file are swallowed where that keeps the UI usable (a corrupt file must not hide
 * the other sessions or break the live chat).
 *
 * UI messages are stored as the browser sent them. The file protocol is
 * `JsonDirectory`.
 */
export class WebSessionStore {
  private readonly files: JsonDirectory<WebSessionRecord>;

  constructor(dir?: string) {
    this.files = new JsonDirectory(dir ?? join(codebergHome(), 'web-sessions'));
  }

  async save(record: WebSessionRecord): Promise<void> {
    await this.files.save(record);
  }

  async load(id: string): Promise<WebSessionRecord | null> {
    return this.files.load(id);
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list(): Promise<WebSessionSummary[]> {
    const records = await this.files.list();
    return records.map((record) => ({
      id: record.id,
      title: record.title,
      updatedAt: record.updatedAt,
      turns: countUserTurns(record.messages),
      ...(record.parentId ? { parentId: record.parentId } : {}),
    }));
  }

  async remove(id: string): Promise<void> {
    await this.files.remove(id);
  }
}
