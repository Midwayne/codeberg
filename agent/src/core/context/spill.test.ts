import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { ContextStore } from './store.js';
import { isSpillPreview, presentToolOutput, SPILL_CHARS, spillPreview } from './spill.js';
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
    const file = join(store.root, 'tools', 'grep-1.txt');
    expect(String(seen)).toContain(file);
    expect(readFileSync(file, 'utf8')).toBe(body);
    expect(readFileSync(join(store.root, 'tools', 'INDEX.txt'), 'utf8')).toContain(file);
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
});
