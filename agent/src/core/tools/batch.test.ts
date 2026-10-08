import { tool, jsonSchema, type ToolExecutionOptions, type ToolSet } from 'ai';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isSpillPreview } from '../context/spill.js';
import { ContextStore } from '../context/store.js';
import { BATCH_TOOL, batchTool, isBatchable, MAX_BATCH_CALLS } from './batch.js';

const options = { toolCallId: 'call-1', messages: [] } as unknown as ToolExecutionOptions<unknown>;

const anyArgs = jsonSchema<Record<string, unknown>>({ type: 'object' });

function store(): ContextStore {
  return ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-batch-')));
}

function slowTools(log: { active: number; peak: number }): ToolSet {
  const lookup = (label: string) =>
    tool({
      inputSchema: anyArgs,
      execute: async (args) => {
        log.active++;
        log.peak = Math.max(log.peak, log.active);

        await new Promise((resolve) => setTimeout(resolve, 20));

        log.active--;

        return `${label}:${JSON.stringify(args)}`;
      },
    });

  return {
    grep: lookup('grep'),
    read_file: lookup('read_file'),
    canvas_update: lookup('canvas'),
    mcp_github_create_issue: lookup('mcp'),
    broken: tool({
      inputSchema: anyArgs,
      execute: async (): Promise<string> => {
        throw new Error('daemon unavailable');
      },
    }),
  };
}

async function run(tools: ToolSet, calls: unknown[]) {
  const batch = batchTool(tools, store())[BATCH_TOOL] as unknown as {
    execute: (input: unknown, opts: ToolExecutionOptions<unknown>) => Promise<unknown[]>;
  };

  return batch.execute({ calls }, options);
}

describe('batch tool', () => {
  it('runs independent calls concurrently and returns results in call order', async () => {
    const log = { active: 0, peak: 0 };

    const results = await run(slowTools(log), [
      { tool: 'grep', args: { pattern: 'a' } },
      { tool: 'read_file', args: { path: 'b.c' } },
      { tool: 'grep', args: { pattern: 'c' } },
    ]);

    expect(log.peak).toBe(3);
    expect(results).toEqual([
      { tool: 'grep', result: 'grep:{"pattern":"a"}' },
      { tool: 'read_file', result: 'read_file:{"path":"b.c"}' },
      { tool: 'grep', result: 'grep:{"pattern":"c"}' },
    ]);
  });

  it('isolates failures and refuses tools that are not batchable', async () => {
    const results = await run(slowTools({ active: 0, peak: 0 }), [
      { tool: 'broken', args: {} },
      { tool: 'canvas_update', args: {} },
      { tool: 'mcp_github_create_issue', args: {} },
      { tool: 'nope', args: {} },
      { tool: 'grep', args: { pattern: 'ok' } },
    ]);

    expect(results[0]).toEqual({ tool: 'broken', error: 'daemon unavailable' });
    expect(results[1]).toMatchObject({ error: expect.stringContaining('non-batchable') });
    expect(results[2]).toMatchObject({ error: expect.stringContaining('non-batchable') });
    expect(results[3]).toMatchObject({ error: expect.stringContaining('non-batchable') });
    expect(results[4]).toEqual({ tool: 'grep', result: 'grep:{"pattern":"ok"}' });
  });

  it('runs at most the call limit and says what it skipped', async () => {
    const calls = Array.from({ length: MAX_BATCH_CALLS + 2 }, (_, i) => ({
      tool: 'grep',
      args: { pattern: String(i) },
    }));

    const results = await run(slowTools({ active: 0, peak: 0 }), calls);

    expect(results).toHaveLength(MAX_BATCH_CALLS + 1);
    expect(results.at(-1)).toEqual({ error: expect.stringContaining('2 call(s)') });
  });

  it('spills large results against a shared batch budget', async () => {
    const big = tool({ inputSchema: anyArgs, execute: async () => 'x'.repeat(5_000) });

    const one = await run({ read_file: big }, [{ tool: 'read_file', args: {} }]);
    const many = await run(
      { read_file: big },
      Array.from({ length: 6 }, () => ({ tool: 'read_file', args: {} })),
    );

    expect((one[0] as { result: unknown }).result).toBe('x'.repeat(5_000));
    expect(isSpillPreview((many[0] as { result: string }).result)).toBe(true);
  });

  it('lists only batchable tools in its schema and skips itself', () => {
    expect(isBatchable(BATCH_TOOL)).toBe(false);
    expect(isBatchable('load_mcp_tools')).toBe(false);
    expect(isBatchable('search_code')).toBe(true);

    const set = batchTool(slowTools({ active: 0, peak: 0 }), store());
    const schema = JSON.stringify((set[BATCH_TOOL] as { inputSchema: unknown }).inputSchema);

    expect(schema).toContain('"grep"');
    expect(schema).not.toContain('canvas_update');
    expect(schema).not.toContain('mcp_github_create_issue');
  });
});
