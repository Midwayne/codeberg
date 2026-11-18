import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMissing, writeJsonAtomic } from '../../fs.js';
import type { ProfileNote } from './types.js';

/** One small JSON file per project; writes are serialized within the process. */
export class ProfileStore {
  readonly path: string;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, 'profile', 'notes.json');
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

  /** Read, transform and write under one in-process lock so a delete cannot race an extraction. */
  update(change: (notes: ProfileNote[]) => ProfileNote[]): Promise<ProfileNote[]> {
    const next = this.queue.then(async () => {
      const notes = change(await this.list());

      await writeJsonAtomic(this.path, { schema_version: 1, notes });

      return notes;
    });

    this.queue = next.catch(() => undefined);

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
