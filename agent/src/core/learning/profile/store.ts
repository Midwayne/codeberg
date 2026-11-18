import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMissing, writeJsonAtomic } from '../../fs.js';
import type { ProfileNote } from './types.js';

/**
 * Writers share one queue and revision per file, so the chat `remember` tool,
 * the background extractor and the settings page never race each other.
 */
const files = new Map<string, { queue: Promise<unknown>; revision: number }>();

function shared(path: string) {
  let entry = files.get(path);
  if (!entry) {
    entry = { queue: Promise.resolve(), revision: 0 };
    files.set(path, entry);
  }

  return entry;
}

/** One small JSON file per project. */
export class ProfileStore {
  readonly path: string;

  constructor(root: string) {
    this.path = join(root, 'profile', 'notes.json');
  }

  /** Increments on every write in this process; chats rebuild their prompt when it changes. */
  get revision(): number {
    return shared(this.path).revision;
  }

  async list(): Promise<ProfileNote[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isMissing(error)) return [];

      throw error;
    }

    const value = JSON.parse(raw) as { notes?: ProfileNote[] };

    return Array.isArray(value.notes) ? value.notes : [];
  }

  /** Read, transform and write under the shared lock. */
  update(change: (notes: ProfileNote[]) => ProfileNote[]): Promise<ProfileNote[]> {
    const entry = shared(this.path);
    const next = entry.queue.then(async () => {
      const notes = change(await this.list());

      await writeJsonAtomic(this.path, { schema_version: 1, notes });
      entry.revision++;

      return notes;
    });

    entry.queue = next.catch(() => undefined);

    return next;
  }

  async remove(id: string): Promise<boolean> {
    let removed = false;

    await this.update((notes) => {
      removed = notes.some((note) => note.id === id);

      return notes.filter((note) => note.id !== id);
    });

    return removed;
  }
}
