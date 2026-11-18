import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMissing, writeJsonAtomic } from '../fs.js';

export interface KnowledgeUse {
  count: number;
  last_used_at: string;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * How often chats retrieve each finding, so people can see what memory is
 * actually used and prune what never is. Writes share one queue per file.
 */
export class KnowledgeUsage {
  readonly path: string;

  constructor(root: string) {
    this.path = join(root, 'knowledge-usage.json');
  }

  async all(): Promise<Record<string, KnowledgeUse>> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as {
        uses?: Record<string, KnowledgeUse>;
      };

      return value.uses ?? {};
    } catch (error) {
      if (isMissing(error)) return {};

      throw error;
    }
  }

  record(ids: string[], now = new Date().toISOString()): Promise<void> {
    if (!ids.length) return Promise.resolve();

    const next = (queues.get(this.path) ?? Promise.resolve()).then(async () => {
      const uses = await this.all();

      for (const id of new Set(ids)) {
        uses[id] = { count: (uses[id]?.count ?? 0) + 1, last_used_at: now };
      }

      await writeJsonAtomic(this.path, { schema_version: 1, uses });
    });

    queues.set(
      this.path,
      next.catch(() => undefined),
    );

    return next;
  }
}
