import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';

import { streamingTool } from './streaming.js';
import { toolTimeoutMs, withToolTimeouts } from './timeout.js';

afterEach(() => vi.useRealTimers());

const schema = jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} });

const options = { toolCallId: "c1", messages: [] } as unknown as ToolExecutionOptions<unknown>;

function hung(seen: AbortSignal[]) {
  return tool({ inputSchema: schema, execute: async (_input, { abortSignal }): Promise<string> => {
    seen.push(abortSignal!);

    return new Promise<string>(() => undefined);
  } });
}

it('stops an ordinary tool call that never returns, so the turn can continue', async () => {
  vi.useFakeTimers();
  const seen: AbortSignal[] = [];
  const tools = withToolTimeouts({ mcp_db_query: hung(seen) }, 60_000);

  const result = expect(tools.mcp_db_query!.execute!({}, options)).rejects.toThrow(/mcp_db_query did not finish within 1 minute/);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(seen[0]!.aborted).toBe(false);

  await vi.advanceTimersByTimeAsync(1_000);
  await result;

  expect(seen[0]!.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("passes results through and keeps the caller's stop signal", async () => {
  const stop = new AbortController();
  let signal: AbortSignal | undefined;
  const tools = withToolTimeouts({ grep: tool({ inputSchema: schema, execute: async (_input, { abortSignal }) => {
    signal = abortSignal;

    return 'match';
  } }) }, 60_000);

  expect(await tools.grep!.execute!({}, { ...options, abortSignal: stop.signal })).toBe('match');

  stop.abort();
  expect(signal!.aborted).toBe(true);
});

it('leaves long-by-design tools, streaming tools, and agent controls without a limit', () => {
  const plain = () => tool({ inputSchema: schema, execute: async () => 'ok' });
  const tools: ToolSet = {
    run_script: plain(), browser_task: plain(), sleep_agent: plain(), start_background_tool: plain(),
    schedule_run: plain(), run_subagents: streamingTool(plain()), grep: plain(),
  };

  const wrapped = withToolTimeouts(tools, 60_000);

  for (const name of ['run_script', 'browser_task', 'sleep_agent', 'start_background_tool', 'schedule_run', 'run_subagents']) {
    expect(wrapped[name]).toBe(tools[name]);
  }
  expect(wrapped.grep).not.toBe(tools.grep);
});

it('reads CODEBERG_TOOL_TIMEOUT_MS, where 0 turns the limit off', () => {
  expect(toolTimeoutMs({})).toBe(600_000);
  expect(toolTimeoutMs({ CODEBERG_TOOL_TIMEOUT_MS: '120000' })).toBe(120_000);
  expect(toolTimeoutMs({ CODEBERG_TOOL_TIMEOUT_MS: '0' })).toBeUndefined();
  expect(toolTimeoutMs({ CODEBERG_TOOL_TIMEOUT_MS: 'never' })).toBe(600_000);

  const tools = { grep: tool({ inputSchema: schema, execute: async () => 'ok' }) };
  expect(withToolTimeouts(tools, undefined)).toBe(tools);
});
