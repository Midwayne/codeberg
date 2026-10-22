import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolSet } from 'ai';

export interface ToolObservation {
  kind: 'tool';
  id: string;
  name: string;
  state: 'started' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ToolJournalContext {
  append: (entry: ToolObservation) => Promise<void>;
  pending: Set<Promise<unknown>>;
}

export const toolJournal = new AsyncLocalStorage<ToolJournalContext>();

type Execute = (input: unknown, options: { toolCallId: string }) => unknown;

/** Resolve a tool only after its outcome is durable; a missing outcome remains uncertain. */
export function recordToolExecutions(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute as Execute | undefined;
    if (!execute) return [name, definition];

    return [name, { ...definition, execute: async (input: unknown, options: { toolCallId: string }) => {
      const context = toolJournal.getStore();
      if (!context) return execute.call(definition, input, options);

      const result = executeRecorded(context, { kind: 'tool', id: options.toolCallId, name },
        () => execute.call(definition, input, options), input);
      context.pending.add(result);
      try {
        return await result;
      } finally {
        context.pending.delete(result);
      }
    } }];
  })) as ToolSet;
}

async function executeRecorded(context: ToolJournalContext, base: Pick<ToolObservation, 'kind' | 'id' | 'name'>,
  execute: () => unknown, input: unknown): Promise<unknown> {
  await context.append({ ...base, state: 'started', input });
  let output: unknown;
  try {
    output = await execute();
  } catch (error) {
    await context.append({ ...base, state: 'failed', error: String(error) });
    throw error;
  }

  await context.append({ ...base, state: 'completed', output });

  return output;
}
