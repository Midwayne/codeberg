import type { ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { collectTools, composeTools, type ToolSource } from './source.js';

function src(name: string, set: ToolSet): ToolSource {
  return { name, tools: () => set };
}

describe('collectTools', () => {
  it('merges sources in order', async () => {
    const merged = await collectTools([src('a', { x: {} as never }), src('b', { y: {} as never })]);
    expect(Object.keys(merged).sort()).toEqual(['x', 'y']);
  });

  it('lets earlier sources win on a name collision (no shadowing core tools)', async () => {
    const merged = await collectTools([
      src('first', { dup: { tag: 'first' } as never }),
      src('second', { dup: { tag: 'second' } as never }),
    ]);

    expect((merged.dup as unknown as { tag: string }).tag).toBe('first');
  });

  it('awaits async sources', async () => {
    const asyncSource: ToolSource = {
      name: 'async',
      tools: async () => ({ z: {} as never }),
    };

    expect(Object.keys(await collectTools([asyncSource]))).toEqual(['z']);
  });
});

describe('composeTools', () => {
  it('keeps instructions, batch names, and untimed from sources that registered tools', async () => {
    const composed = await composeTools([
      src('reads', { grep: {} as never }),
      { name: 'empty', instructions: 'skip', batchable: false, untimed: true, tools: () => ({}) },
      { name: 'browser', instructions: '\nbrowser', batchable: false, untimed: true, tools: () => ({ browser_task: {} as never }) },
    ]);

    expect(composed.instructions).toEqual(['\nbrowser']);
    expect(composed.batchable).toEqual(['grep']);
    expect(composed.untimed).toBe(true);
    expect(Object.keys(composed.tools)).toEqual(['grep', 'browser_task']);
  });

  it('omits server-only sources unless this loop serves a server chat', async () => {
    const server = { name: 'schedules', serverOnly: true, tools: () => ({ schedule_run: {} as never }) };

    expect(Object.keys((await composeTools([server])).tools)).toEqual([]);
    expect(Object.keys((await composeTools([server], { server: true })).tools)).toEqual(['schedule_run']);
  });

  it('passes tools registered so far to the next source', async () => {
    let seen: string[] = [];
    const composed = await composeTools([
      src('first', { grep: {} as never }),
      { name: 'later', tools: (earlier) => {
        seen = Object.keys(earlier ?? {});

        return { extra: {} as never };
      } },
    ]);

    expect(seen).toEqual(['grep']);
    expect(Object.keys(composed.tools)).toEqual(['grep', 'extra']);
  });
});
