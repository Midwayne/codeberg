import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { ContextStore } from './store.js';
import { contextTools } from './tools.js';

type Execute = (input: Record<string, unknown>, options: unknown) => Promise<string>;

it('pages long lines with explicit continuation positions and bounded output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-page-'));

  try {
    const store = ContextStore.open(root);
    const text = `opening${'x'.repeat(30000)}ending`;
    await store.writeRel('long.txt', text);
    const read = contextTools(store).context_read!.execute as Execute;
    const first = await read({ path: 'long.txt' }, {});

    expect(first.length).toBeLessThan(12000);
    expect(first).toContain('opening');
    expect(first).toMatch(/next_start_line=1; next_start_column=\d+/);

    const column = Number(first.match(/next_start_column=(\d+)/)![1]);
    const second = await read({ path: 'long.txt', start_line: 1, start_column: column }, {});

    expect(second.length).toBeLessThan(12000);
    expect(second).toContain(`1:${column}|`);
    expect(second).not.toContain('opening');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('finds literal and regex matches across read chunks without emitting huge lines', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-grep-'));

  try {
    const store = ContextStore.open(root);
    await store.writeRel('long.txt', `opening${'x'.repeat(32760)}needle😀${'y'.repeat(20000)}ending`);
    const grep = contextTools(store).context_grep!.execute as Execute;

    const literal = await grep({ path: 'long.txt', pattern: 'needle😀' }, {});
    const regex = await grep({ path: 'long.txt', pattern: '^opening.*needle.*ending$', literal: false }, {});

    expect(literal).toContain('needle😀');
    expect(literal.length).toBeLessThan(12000);
    expect(literal).toContain('column=');
    expect(regex).toContain('opening');
    expect(regex.length).toBeLessThan(12000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps CRLF line numbers and Unicode intact across pages and tails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-unicode-'));

  try {
    const store = ContextStore.open(root);
    await store.writeRel('unicode.txt', `${'a'.repeat(32767)}\r\n😀 second\r\nthird`);
    const tools = contextTools(store);
    const read = tools.context_read!.execute as Execute;
    const tail = tools.context_tail!.execute as Execute;

    expect(await read({ path: 'unicode.txt', start_line: 2, end_line: 2 }, {})).toContain('2|😀 second');
    expect(await tail({ path: 'unicode.txt', lines: 2 }, {})).toContain('3|third');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('recovers every character by following continuation positions across Unicode fragments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-all-pages-'));

  try {
    const store = ContextStore.open(root);
    const original = [`opening${'😀abc'.repeat(7000)}ending`, 'second line', 'last line'];
    await store.writeRel('all.txt', original.join('\n'));
    const read = contextTools(store).context_read!.execute as Execute;
    const recovered = new Map<number, string>();
    let line = 1;
    let column = 1;
    let finished = false;

    for (let page = 0; page < 20; page++) {
      const output = await read({ path: 'all.txt', start_line: line, start_column: column }, {});
      expect(new TextDecoder().decode(new TextEncoder().encode(output))).toBe(output);

      for (const entry of output.split('\n')) {
        const match = /^(\d+)(?::(\d+))?\|(.*)$/.exec(entry);
        if (!match) continue;

        const number = Number(match[1]);
        const existing = recovered.get(number) ?? '';
        expect(Number(match[2] ?? 1)).toBe(existing.length + 1);
        recovered.set(number, existing + match[3]);
      }

      const next = /next_start_line=(\d+); next_start_column=(\d+)/.exec(output);
      if (!next) {
        finished = true;
        break;
      }

      line = Number(next[1]);
      column = Number(next[2]);
    }

    expect(finished).toBe(true);
    expect([...recovered.values()]).toEqual(original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
