import { describe, expect, it, vi } from 'vitest';

import { DaemonError, type DaemonClient } from '../client.js';
import { daemonToolSource } from './daemon.js';

function run(toolDef: unknown, input: unknown): Promise<any> {
  return (toolDef as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, {
    toolCallId: 't',
    messages: [],
  }) as Promise<any>;
}

describe('daemonToolSource', () => {
  it('exposes missing files rather than a generic tool failure', async () => {
    const daemon = {
      listTools: vi.fn(async () => [{ name: 'read_file', description: 'read', schema: { type: 'object' } }]),
      callTool: vi.fn(async () => { throw new DaemonError('NOT_FOUND', 'codeberg: not found: missing.kt', 404); }),
    } as unknown as DaemonClient;
    const set = await daemonToolSource({ daemon }).tools();
    expect(await run(set.read_file, { path: 'missing.kt' })).toEqual({
      error: 'NOT_FOUND: codeberg: not found: missing.kt',
    });
  });
  it('bridges each advertised tool and forwards calls to the daemon', async () => {
    const daemon = {
      listTools: vi.fn(async () => [
        {
          name: 'grep',
          description: 'exact search',
          schema: { type: 'object' },
        },
        {
          name: 'search',
          description: 'vector search',
          schema: { type: 'object' },
        },
        {
          name: 'get_chunk',
          description: 'chunk body',
          schema: { type: 'object' },
        },
        {
          name: 'hybrid_search',
          description: 'hybrid',
          schema: { type: 'object' },
        },
        { name: 'read_file', description: 'read', schema: { type: 'object' } },
      ]),
      callTool: vi.fn(async () => ({ ok: true })),
    } as unknown as DaemonClient;

    const captured: string[] = [];
    const set = await daemonToolSource({
      daemon,
      onToolResult: (name) => captured.push(name),
    }).tools();
    expect(Object.keys(set).sort()).toEqual(['get_chunk', 'grep', 'hybrid_search', 'read_file']);

    const out = await run(set.grep, { pattern: 'x' });
    expect(daemon.callTool).toHaveBeenCalledWith('grep', { pattern: 'x' });
    expect(out).toEqual({ ok: true });
    expect(captured).toEqual(['grep']);
  });
});
