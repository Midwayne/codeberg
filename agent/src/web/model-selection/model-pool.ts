import type { ToolLoopAgent } from 'ai';

import { evictOldest, touch } from '../../core/lru.js';
import { writeModuleLog } from '../../core/module-log.js';
import type { ResolvedModelSelection } from '../chat-routes.js';

/** Unused agents kept warm for quick switching back; older idle ones are closed. */
export const MAX_IDLE_AGENTS = 4;

interface PooledLoop {
  loop: Promise<ToolLoopAgent>;
  users: number;
}

/**
 * A loop's model, effort, and history budget are immutable for its lifetime,
 * so each distinct selection gets its own agent. Turns `retain` the agent they
 * use; idle agents beyond `MAX_IDLE_AGENTS` are closed, least recently used first.
 */
export class ModelAgentPool {
  private readonly loops = new Map<string, PooledLoop>();

  constructor(
    private readonly options: {
      build: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
      /** Close one agent's connections (MCP clients, browser sessions). */
      closeLoop?: (loop: ToolLoopAgent) => Promise<void>;
      close?: () => Promise<void>;
    },
  ) {}

  forSelection(selection: ResolvedModelSelection): Promise<ToolLoopAgent> {
    return this.entry(selection).loop;
  }

  /** Keep this selection's agent open until the returned release runs. */
  retain(selection: ResolvedModelSelection): () => Promise<void> {
    const entry = this.entry(selection);
    entry.users++;
    let released = false;

    return async () => {
      if (released) return;

      released = true;
      entry.users--;
      await this.evictIdle();
    };
  }

  async close(): Promise<void> {
    await this.options.close?.();
  }

  /** The pooled agent for a selection, marked most recently used; one key per distinct selection. */
  private entry(selection: ResolvedModelSelection): PooledLoop {
    const key = JSON.stringify(selection);
    const existing = this.loops.get(key);
    if (existing) return touch(this.loops, key, existing);

    const loop = this.options.build(selection).catch((error: unknown) => {
      this.loops.delete(key);
      throw error;
    });

    return touch(this.loops, key, { loop, users: 0 });
  }

  private async evictIdle(): Promise<void> {
    const idle = [...this.loops.values()].filter((entry) => entry.users === 0).length;
    if (idle <= MAX_IDLE_AGENTS) return;

    // Keep busy agents plus the MAX_IDLE_AGENTS most recently used idle ones.
    const busy = this.loops.size - idle;
    const excess = evictOldest(this.loops, busy + MAX_IDLE_AGENTS, (entry) => entry.users === 0);

    // Releasing runs at the end of a turn, so a failed close is logged, never thrown.
    await Promise.all(excess.map(async ([, entry]) => {
      try {
        await entry.loop.then((loop) => this.options.closeLoop?.(loop), () => undefined);
      } catch (error) {
        writeModuleLog('agent', 'idle_agent_close_failed', { error: String(error) });
      }
    }));
  }
}
