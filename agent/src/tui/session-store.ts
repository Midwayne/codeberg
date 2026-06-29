import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelMessage } from "ai";

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
}

/** Lightweight row for the `/sessions` list (no message bodies loaded). */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
}

/**
 * The managed directory for codeberg state. Mirrors the launcher's Go
 * `paths.Home`: honour CODEBERG_HOME, else ~/.codeberg.
 */
function home(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEBERG_HOME) {
    return env.CODEBERG_HOME;
  }
  return join(homedir(), ".codeberg");
}

/** Count user turns in a record, for the `/sessions` listing. */
function countTurns(messages: ModelMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/**
 * File-backed store of chat sessions under `<CODEBERG_HOME>/sessions/`.
 * One JSON file per session, named `<id>.json`. Read/write failures on an
 * individual file are swallowed where it keeps the TUI usable (a corrupt file
 * should not crash the chat or hide the other sessions).
 */
export class SessionStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(home(), "sessions");
  }

  /** A short, file-safe id. Injectable in tests via `save`-provided ids. */
  static newId(): string {
    return randomBytes(3).toString("hex");
  }

  async save(record: SessionRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async load(id: string): Promise<SessionRecord | null> {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), "utf8");
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list(): Promise<SessionSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const summaries: SessionSummary[] = [];
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

  /**
   * Resolve a user-typed id to a stored session: exact match first, then a
   * unique prefix. Returns null when nothing matches or a prefix is ambiguous.
   */
  async resolve(idOrPrefix: string): Promise<SessionRecord | null> {
    const exact = await this.load(idOrPrefix);
    if (exact) {
      return exact;
    }
    const matches = (await this.list()).filter((s) =>
      s.id.startsWith(idOrPrefix),
    );
    if (matches.length !== 1) {
      return null;
    }
    return this.load(matches[0]!.id);
  }
}
