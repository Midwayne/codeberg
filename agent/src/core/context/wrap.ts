import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type { ToolSet } from 'ai';

import { toolResultOutputText } from '../message.js';
import { presentToolOutput, recordTerminal, spillText } from './spill.js';
import type { ContextStore } from './store.js';

type Executable = {
  execute?: (args: unknown, options: unknown) => Promise<unknown> | unknown;
  toModelOutput?: (options: {
    toolCallId: string;
    input: unknown;
    output: unknown;
  }) => PromiseLike<ToolResultOutput> | ToolResultOutput;
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
    const toModelOutput = (def as Executable).toModelOutput;
    if (typeof toModelOutput === 'function') {
      wrapped[name] = {
        ...(def as object),
        // Provider-defined converters such as MCP require their raw result.
        // Spill only after that converter has produced model-facing output.
        execute: async (args: unknown, options: unknown) => execute.call(def, args, options),
        toModelOutput: async (options: {
          toolCallId: string;
          input: unknown;
          output: unknown;
        }) => {
          const output = await toModelOutput.call(def, options);
          const text = toolResultOutputText(output);
          try {
            await recordTerminal(store, name, options.input, text);
            const preview = await spillText(store, name, text);
            return preview ? { type: 'text' as const, value: preview } : output;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`› context: failed to spill ${name}: ${message}`);
            return output;
          }
        },
      } as unknown as ToolSet[string];
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
