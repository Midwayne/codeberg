import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolSet } from 'ai';

import { sleep } from '../sleep.js';
import { toolInputLabel } from '../tool-label.js';

/** What one subagent is doing right now, reported from inside its loop. */
export interface ProgressSink {
  step: (stepNumber: number) => void;
  tool: (name: string, input: unknown) => void;
}

export const progressScope = new AsyncLocalStorage<ProgressSink>();

/** Tell the running subagent's sink about each tool call, without changing results. */
export function reportingTools(tools: ToolSet): ToolSet {
  const out: ToolSet = {};

  for (const [name, definition] of Object.entries(tools)) {
    const execute = definition.execute;
    if (!execute) {
      out[name] = definition;
      continue;
    }

    out[name] = {
      ...definition,
      execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
        progressScope.getStore()?.tool(name, input);

        return execute.call(definition, input as never, options);
      },
    } as ToolSet[string];
  }

  return out;
}

/** A short, human label for a tool call: its query, pattern, path, or name argument. */
export function activityLabel(name: string, input: unknown): string {
  const detail = toolInputLabel(input);

  return detail ? `${name} · ${detail.slice(0, 80)}` : name;
}

/**
 * Snapshots of several items as they change, for an async-generator tool.
 * `changes()` yields at most every `intervalMs` while work runs, then
 * finishes once `done` settles; the caller yields the final value itself.
 */
export class ProgressFeed<T> {
  private wake?: () => void;

  private dirty = false;

  constructor(readonly items: T[], private readonly intervalMs = 250) {}

  update(index: number, patch: Partial<T>): void {
    this.items[index] = { ...this.items[index]!, ...patch };
    this.dirty = true;
    this.wake?.();
  }

  async *changes(done: Promise<unknown>): AsyncGenerator<T[]> {
    let finished = false;
    void done.finally(() => {
      finished = true;
      this.wake?.();
    }).catch(() => undefined);

    yield [...this.items];

    while (!finished) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        if (this.dirty || finished) resolve();
      });
      this.wake = undefined;
      if (finished) break;

      this.dirty = false;
      yield [...this.items];
      await Promise.race([sleep(this.intervalMs), done.catch(() => undefined)]);
    }
  }
}
