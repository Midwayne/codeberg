import { jsonSchema, tool } from 'ai';
import { expect, it } from 'vitest';

import { streamingTool } from '../tools/streaming.js';
import { recordToolExecutions, toolJournal, type ToolObservation } from './tools.js';

it('passes a streaming tool through and records its final value once it finishes', async () => {
  const entries: ToolObservation[] = [];
  const tools = recordToolExecutions({
    progress: streamingTool(tool({
      description: 'streams',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      async *execute() {
        yield { done: 1 };
        yield { done: 2 };
      },
    })),
  });

  const context = { append: async (entry: ToolObservation) => void entries.push(entry), pending: new Set<Promise<unknown>>() };
  const items: unknown[] = await toolJournal.run(context, async () => {
    const output = tools.progress!.execute!({}, { toolCallId: 'call', messages: [] } as never);
    const seen: unknown[] = [];
    for await (const item of output as AsyncIterable<unknown>) seen.push(item);

    return seen;
  });

  expect(items).toEqual([{ done: 1 }, { done: 2 }]);
  expect(entries.map((entry) => [entry.state, entry.output])).toEqual([
    ['started', undefined],
    ['completed', { done: 2 }],
  ]);
});

function streamingTools(gate?: Promise<void>) {
  return recordToolExecutions({
    progress: streamingTool(tool({
      description: 'streams',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      async *execute() {
        yield { done: 1 };
        await gate;
        yield { done: 2 };
      },
    })),
  });
}

function journal() {
  const entries: ToolObservation[] = [];
  const context = { append: async (entry: ToolObservation) => void entries.push(entry), pending: new Set<Promise<unknown>>() };

  return { entries, context };
}

it('keeps a streaming call pending until its outcome is recorded', async () => {
  const { entries, context } = journal();
  const output = toolJournal.run(context, () => streamingTools().progress!.execute!({}, { toolCallId: 'c', messages: [] } as never));

  expect(context.pending.size).toBe(1);

  for await (const _item of output as AsyncIterable<unknown>) { /* drain */ }
  await Promise.allSettled([...context.pending]);

  expect(context.pending.size).toBe(0);
  expect(entries.at(-1)).toMatchObject({ state: 'completed', output: { done: 2 } });
});

it('records an abandoned stream as unfinished', async () => {
  const { entries, context } = journal();
  const output = toolJournal.run(context, () => streamingTools().progress!.execute!({}, { toolCallId: 'c', messages: [] } as never));

  for await (const _item of output as AsyncIterable<unknown>) break;
  await Promise.allSettled([...context.pending]);

  expect(entries.map((entry) => entry.state)).toEqual(['started', 'failed']);
  expect(context.pending.size).toBe(0);
});

it('settles a suspended stream when the run aborts, so shutdown never waits forever', async () => {
  const { entries, context } = journal();
  const controller = new AbortController();
  const never = new Promise<void>(() => undefined);
  const output = toolJournal.run(context, () => streamingTools(never).progress!.execute!({},
    { toolCallId: 'c', messages: [], abortSignal: controller.signal } as never)) as AsyncIterable<unknown>;

  const iterator = output[Symbol.asyncIterator]();
  await iterator.next();
  void iterator.next();
  controller.abort();
  await Promise.allSettled([...context.pending]);

  expect(entries.map((entry) => entry.state)).toEqual(['started', 'failed']);
  expect(context.pending.size).toBe(0);
});

it('settles at once, and starts nothing, when the run was already aborted', async () => {
  const { entries, context } = journal();
  const controller = new AbortController();
  controller.abort();

  const output = toolJournal.run(context, () => streamingTools().progress!.execute!({},
    { toolCallId: 'c', messages: [], abortSignal: controller.signal } as never)) as AsyncIterable<unknown>;
  await Promise.allSettled([...context.pending]);

  const items: unknown[] = [];
  for await (const item of output) items.push(item);

  expect(context.pending.size).toBe(0);
  expect(items).toEqual([]);
  expect(entries.map((entry) => entry.state)).toEqual(['failed']);
});
