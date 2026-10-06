import type { ResolvedModelSelection } from '../chat-routes.js';
import type { ModelAgentPool } from './runtime.js';

export interface PoolGeneration {
  pool: ModelAgentPool;
  revision: number;
  users: number;
  retired: boolean;
}

/** Extension edits affect subsequent turns; in-flight turns retain their MCP
 * clients until their stream and response have both finished. */
export class ReloadableAgentPool {
  private current?: PoolGeneration;
  private readonly generations = new Set<PoolGeneration>();

  constructor(private readonly build: () => ModelAgentPool) {}

  async acquire(selection: ResolvedModelSelection, revision: number) {
    let previous: PoolGeneration | undefined;
    if (!this.current || this.current.revision !== revision) {
      previous = this.current;
      if (previous) previous.retired = true;

      this.current = { pool: this.build(), revision, users: 0, retired: false };
      this.generations.add(this.current);
    }

    // Capture ownership before yielding: concurrent requests share this generation.
    const generation = this.current;
    generation.users++;
    let released = false;
    const release = async () => {
      if (released) return;

      released = true;
      generation.users--;
      await this.retire(generation);
    };

    try {
      if (previous) await this.retire(previous);

      return { agent: await generation.pool.forSelection(selection), release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async retire(generation: PoolGeneration) {
    if (!generation.retired || generation.users > 0 || !this.generations.delete(generation)) return;

    await generation.pool.close();
  }

  async close() {
    for (const generation of this.generations) generation.retired = true;

    await Promise.all([...this.generations].map((generation) => this.retire(generation)));
  }
}
