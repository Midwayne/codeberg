import type { ToolSet } from 'ai';

import { presentToolOutput } from './spill.js';
import type { ContextStore } from './store.js';

type Executable = {
  execute?: (args: unknown, options: unknown) => Promise<unknown> | unknown;
};

/**
 * Wrap every tool execute so long results are spilled to the context store
 * before they enter the model transcript. Tools without `execute` pass through.
 */
export function wrapToolOutputs(tools: ToolSet, store: ContextStore): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    const execute = (def as Executable).execute;
    if (typeof execute !== 'function') {
      wrapped[name] = def;
      continue;
    }
    wrapped[name] = {
      ...(def as object),
      execute: async (args: unknown, options: unknown) => {
        const result = await execute.call(def, args, options);
        return presentToolOutput(store, name, args, result);
      },
    } as ToolSet[string];
  }
  return wrapped;
}
