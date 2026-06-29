import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { UIMessage } from "ai";

/** One persisted browser chat — UI messages verbatim, so a resume re-renders
 *  with full fidelity (tool cards, reasoning, citations). */
export interface WebSessionRecord {
  id: string;
  /** Derived from the first user message; shown in the sidebar. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

/** Lightweight row for the sidebar list (no message bodies sent). */
export interface WebSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
}

/**
 * Session ids double as filenames and arrive from the client, so constrain them
 * to a safe charset — this is the guard against path traversal on the by-id
 * routes (a `../` id can never reach `join`).
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Mirrors the launcher's Go `paths.Home`: honour CODEBERG_HOME, else ~/.codeberg. */
function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBERG_HOME ?? join(homedir(), ".codeberg");
}

function countTurns(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/**
 * File-backed store of browser chat sessions under `<CODEBERG_HOME>/web-sessions/`,
 * one JSON file per session (`<id>.json`). Read/write failures on an individual
 * file are swallowed where that keeps the UI usable (a corrupt file must not hide
 * the other sessions or break the live chat).
 *
 * Deliberately separate from the TUI's `SessionStore`, which persists
 * `ModelMessage`s: converting between the UI and model shapes is lossy, so each
 * surface keeps its native format rather than sharing one store.
 */
export class WebSessionStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(home(), "web-sessions");
  }

  async save(record: WebSessionRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async load(id: string): Promise<WebSessionRecord | null> {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), "utf8");
      return JSON.parse(raw) as WebSessionRecord;
    } catch {
      return null;
    }
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list(): Promise<WebSessionSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const summaries: WebSessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const record = await this.load(file.slice(0, -".json".length));
      if (record) {
        summaries.push({
          id: record.id,
          title: record.title,
          updatedAt: record.updatedAt,
          turns: countTurns(record.messages),
        });
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(join(this.dir, `${id}.json`));
    } catch {
      // already gone / unreadable — nothing to do
    }
  }
}
