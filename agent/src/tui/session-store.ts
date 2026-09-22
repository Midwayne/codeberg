import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import type { ModelMessage } from 'ai';

import { countUserTurns, JsonDirectory } from '../core/json-directory.js';
import { codebergHome } from '../core/paths.js';

/** One persisted chat, replayed into model context when resumed. */
export interface SessionRecord {
  id: string;
  /** First user message, truncated. Shown in `/sessions`. */
  title: string;
  modelSpec: string;
  createdAt: number;
  updatedAt: number;
  /** The clean conversation (no slash-command turns), as model messages. */
  messages: ModelMessage[];
  /** Session this one was branched from, when created via `/branch`. */
  parentId?: string;
}

/** Lightweight row for the `/sessions` list (no message bodies loaded). */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
}

/**
 * File-backed store of chat sessions under `<CODEBERG_HOME>/sessions/`.
 * One JSON file per session, named `<id>.json`. Read/write failures on an
 * individual file are swallowed where it keeps the TUI usable (a corrupt file
 * should not crash the chat or hide the other sessions).
 *
 * The browser store is a separate directory of `UIMessage`s. The file protocol
 * is shared (`JsonDirectory`); the record types are not.
 */
export class SessionStore {
  private readonly files: JsonDirectory<SessionRecord>;

  constructor(dir?: string) {
    this.files = new JsonDirectory(dir ?? join(codebergHome(), 'sessions'));
  }

  /** A short, file-safe id. Injectable in tests via `save`-provided ids. */
  static newId(): string {
    return randomBytes(3).toString('hex');
  }

  async save(record: SessionRecord): Promise<void> {
    await this.files.save(record);
  }

  async load(id: string): Promise<SessionRecord | null> {
    return this.files.load(id);
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list(): Promise<SessionSummary[]> {
    const records = await this.files.list();
    return records.map((record) => ({
      id: record.id,
      title: record.title,
      updatedAt: record.updatedAt,
      turns: countUserTurns(record.messages),
    }));
  }

  /**
   * Resolve a user-typed id to a stored session: exact match first, then a
   * unique prefix. Returns null when nothing matches or a prefix is ambiguous.
   */
  async resolve(idOrPrefix: string): Promise<SessionRecord | null> {
    const exact = await this.load(idOrPrefix);
    if (exact) {
      return exact;
    }
    const matches = (await this.list()).filter((session) => session.id.startsWith(idOrPrefix));
    if (matches.length !== 1) {
      return null;
    }
    return this.load(matches[0]!.id);
  }
}
