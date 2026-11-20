import type { UIMessageChunk } from 'ai';
import { expect, it } from 'vitest';

import { settleInterruptedEvents } from './terminal.js';
import type { SearchRun } from './types.js';

function runWith(events: UIMessageChunk[]): SearchRun {
  return {
    events,
    listeners: new Set(),
    record: { id: 'run' },
    journal: { append: async () => undefined },
  } as unknown as SearchRun;
}

it('closes a streaming tool whose only outputs were preliminary progress', async () => {
  const run = runWith([
    { type: 'tool-input-available', toolCallId: 'fan', toolName: 'other_stream', input: {} },
    { type: 'tool-output-available', toolCallId: 'fan', output: { done: 1 }, preliminary: true },
  ]);

  await settleInterruptedEvents(run);

  expect(run.events.at(-1)).toMatchObject({ type: 'tool-output-error', toolCallId: 'fan' });
});

it('leaves a tool with a final output alone', async () => {
  const run = runWith([
    { type: 'tool-input-available', toolCallId: 'g', toolName: 'grep', input: {} },
    { type: 'tool-output-available', toolCallId: 'g', output: [] },
  ]);

  await settleInterruptedEvents(run);

  expect(run.events).toHaveLength(2);
});

it('keeps finished subagent reports and marks unfinished ones interrupted', async () => {
  const progress = { results: [
    { agent_id: 'sa_1', description: 'a', agent_type: 'explorer', status: 'completed', tool_calls: 2, report: 'fine' },
    { agent_id: 'sa_2', description: 'b', agent_type: 'explorer', status: 'running', tool_calls: 1, activity: 'grep', started_at: 1 },
  ] };
  const run = runWith([
    { type: 'tool-input-available', toolCallId: 'fan', toolName: 'run_subagents', input: {} },
    { type: 'tool-output-available', toolCallId: 'fan', output: progress, preliminary: true },
  ]);

  await settleInterruptedEvents(run);
  const closing = run.events.at(-1) as Extract<UIMessageChunk, { type: 'tool-output-available' }>;

  expect(closing).toMatchObject({ type: 'tool-output-available', toolCallId: 'fan' });
  expect(closing.preliminary).toBeUndefined();
  expect((closing.output as typeof progress).results).toEqual([
    progress.results[0],
    { agent_id: 'sa_2', description: 'b', agent_type: 'explorer', status: 'failed', tool_calls: 1, error: 'Interrupted before it finished.' },
  ]);
});

it('restores a finished report that later snapshots only previewed', async () => {
  const full = 'x'.repeat(600);
  const finished = { agent_id: 'sa_1', description: 'a', agent_type: 'explorer', status: 'completed', tool_calls: 1 };
  const running = { agent_id: 'sa_2', description: 'b', agent_type: 'explorer', status: 'running', tool_calls: 0 };
  const run = runWith([
    { type: 'tool-input-available', toolCallId: 'fan', toolName: 'run_subagents', input: {} },
    { type: 'tool-output-available', toolCallId: 'fan', preliminary: true, output: { results: [{ ...finished, report: full }, running] } },
    { type: 'tool-output-available', toolCallId: 'fan', preliminary: true,
      output: { results: [{ ...finished, report: `${full.slice(0, 280)}…`, report_truncated: true }, running] } },
  ]);

  await settleInterruptedEvents(run);
  const output = (run.events.at(-1) as { output: { results: Array<{ report?: string; report_truncated?: boolean }> } }).output;

  expect(output.results[0]!.report).toBe(full);
  expect(output.results[0]!.report_truncated).toBeUndefined();
});
