import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { ContextStore } from './store.js';
import {
  isSpillPreview,
  presentToolOutput,
  SPILL_CHARS,
  spillPreview,
  spillResultCount,
} from './spill.js';
import { wrapToolOutputs } from './wrap.js';

describe('spillPreview', () => {
  it('names the file and keeps both ends', () => {
    const preview = spillPreview('/tmp/out.txt', 'abcdefghij', 3, 3);
    expect(isSpillPreview(preview)).toBe(true);
    expect(preview).toContain('/tmp/out.txt');
    expect(preview).toContain('abc');
    expect(preview).toContain('hij');
    expect(preview).toContain('context_grep');
  });

  it('preserves the top-level result count for structured arrays', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-spill-count-')));
    const output = Array.from({ length: 42 }, (_, i) => ({ path: `file-${i}`, body: 'x'.repeat(400) }));
    const seen = await presentToolOutput(store, 'grep', { pattern: 'x' }, output, 100);
    expect(isSpillPreview(seen)).toBe(true);
    expect(spillResultCount(seen)).toBe(42);
  });
});

describe('presentToolOutput', () => {
  it('returns short output unchanged and still logs pipe output', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-spill-')));
    const output = { matches: ['a'] };
    const seen = await presentToolOutput(store, 'pipe', { command: 'rg a' }, output);
    expect(seen).toBe(output);
    const log = readFileSync(join(store.root, 'terminals', 'pipe.log'), 'utf8');
    expect(log).toContain('rg a');
    expect(log).toContain('"a"');
  });

  it('spills long output to a file the preview names', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-spill-')));
    const body = 'x'.repeat(SPILL_CHARS + 50);
    const seen = await presentToolOutput(store, 'grep', { pattern: 'x' }, body);
    expect(typeof seen).toBe('string');
    expect(isSpillPreview(String(seen))).toBe(true);
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const file = join(store.root, 'tools', `grep-${hash}.txt`);
    expect(String(seen)).toContain(file);
    expect(readFileSync(file, 'utf8')).toBe(body);
    await presentToolOutput(store, 'grep', { pattern: 'x' }, body);
    const index = readFileSync(join(store.root, 'tools', 'INDEX.txt'), 'utf8').trim().split('\n');
    expect(index).toEqual([`grep\t${file}`]);
  });
});

describe('wrapToolOutputs', () => {
  it('spills the execute result of a long tool call', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-wrap-')));
    const tools: ToolSet = {
      grep: tool({
        description: 'grep',
        inputSchema: { type: 'object', properties: {} } as never,
        execute: async () => 'z'.repeat(SPILL_CHARS + 10),
      }),
    };
    const wrapped = wrapToolOutputs(tools, store);
    const execute = (wrapped.grep as { execute: (args: unknown, opts: unknown) => Promise<unknown> })
      .execute;
    const seen = await execute({}, {});
    expect(isSpillPreview(String(seen))).toBe(true);
  });

  it('preserves custom tool output contracts and spills after toModelOutput', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-wrap-convert-')));
    const raw = {
      content: [{ type: 'text', text: 'z'.repeat(SPILL_CHARS + 10) }],
      isError: false,
    };
    const tools: ToolSet = {
      mcp_query: {
        description: 'MCP query',
        inputSchema: { type: 'object', properties: {} } as never,
        execute: async () => raw,
        toModelOutput: ({ output }: { output: unknown }) => {
          if (!output || typeof output !== 'object' || !('content' in output)) {
            throw new TypeError('expected MCP result');
          }
          return { type: 'content', value: (output as typeof raw).content } as const;
        },
      } as ToolSet[string],
    };
    const wrapped = wrapToolOutputs(tools, store);
    const execute = (wrapped.mcp_query as {
      execute: (args: unknown, opts: unknown) => Promise<unknown>;
    }).execute;
    const toModelOutput = (wrapped.mcp_query as unknown as {
      toModelOutput: (opts: {
        toolCallId: string;
        input: unknown;
        output: unknown;
      }) => PromiseLike<{ type: string; value: unknown }> | { type: string; value: unknown };
    }).toModelOutput;

    const output = await execute({}, {});
    expect(output).toBe(raw);
    const modelOutput = await toModelOutput({ toolCallId: 'call-1', input: {}, output });
    expect(modelOutput.type).toBe('text');
    expect(isSpillPreview(modelOutput.value)).toBe(true);
  });
});
