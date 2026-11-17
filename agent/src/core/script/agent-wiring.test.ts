import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAnthropic } from '@ai-sdk/anthropic';
import { describe, expect, it, vi } from 'vitest';

import { profileFor } from '../../providers/profiles.js';
import { Agent } from '../agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

const SCRIPT = [
  'paths = [hit["path"] for hit in tools.grep(pattern="cberg_chunker_open")]',
  'first = tools.read_file(path=paths[0])',
  'print("checked", paths[0], "lines", len(first["content"].splitlines()))',
].join('\n');

type Body = Record<string, unknown>;

function reply(content: unknown[], stop: string) {
  const body = {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function scriptedFetch(bodies: Body[]) {
  const replies = [
    reply([{ type: 'tool_use', id: 't0', name: 'run_script', input: { code: SCRIPT } }], 'tool_use'),
    reply([{ type: 'text', text: 'Done.' }], 'end_turn'),
  ];

  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);

    return replies.shift()!;
  }) as unknown as typeof globalThis.fetch;
}

function fakeDaemon(calls: string[]) {
  const daemon = new DaemonClient(DEFAULT_DAEMON_URL);
  const schema = { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } } };

  vi.spyOn(daemon, 'waitReady').mockResolvedValue({ ready: true, chunks: 0, version: 'test', vectors_enabled: false });
  vi.spyOn(daemon, 'listTools').mockResolvedValue([
    { name: 'grep', description: 'Search files', schema },
    { name: 'read_file', description: 'Read a file', schema },
  ]);

  vi.spyOn(daemon, 'callTool').mockImplementation(async (name, args) => {
    calls.push(`${name} ${JSON.stringify(args)}`);

    return name === 'grep'
      ? [{ path: 'core/src/chunk.c', line: 12 }]
      : { path: args.path, content: 'a\nb\nc' };
  });

  return daemon;
}

async function ask(env: NodeJS.ProcessEnv) {
  const bodies: Body[] = [];
  const calls: string[] = [];

  const agent = new Agent({
    model: createAnthropic({ apiKey: 'k', fetch: scriptedFetch(bodies) })('claude-opus-4-8'),
    daemon: fakeDaemon(calls),
    env,
    learning: false,
    profile: profileFor('anthropic:model', {}),
    promptHooks: [],
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: { enabled: false, servers: [], files: [], warnings: [] },
    context: ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-script-wiring-'))),
  });

  const result = await agent.ask('where does chunking start?');
  await agent.close();

  return { bodies, calls, sources: result.sources };
}

function offeredTools(body: Body): string[] {
  return ((body.tools ?? []) as { name?: string }[]).map((t) => t.name ?? '');
}

describe.skipIf(!hasPython)('run_script in the agent loop', () => {
  it('is offered only when CODEBERG_SCRIPT_USE is on', async () => {
    const off = await ask({});

    expect(offeredTools(off.bodies[0]!)).not.toContain('run_script');
  });

  it('runs dependent daemon calls and returns the printed summary', async () => {
    const { bodies, calls, sources } = await ask({ CODEBERG_SCRIPT_USE: 'true' });

    expect(offeredTools(bodies[0]!)).toContain('run_script');
    expect(JSON.stringify(bodies[0]!.system)).toContain('## Scripts');

    // The purpose rule reaches the model in both the tool description and the prompt.
    const rule = 'Use this tool ONLY to combine tool calls and process their results';
    const offered = (bodies[0]!.tools as { name: string; description: string }[]).find((t) => t.name === 'run_script');
    expect(offered?.description).toContain(rule);
    expect(JSON.stringify(bodies[0]!.system)).toContain(rule);

    expect(calls).toEqual([
      'grep {"pattern":"cberg_chunker_open"}',
      'read_file {"path":"core/src/chunk.c"}',
    ]);

    expect(JSON.stringify(bodies[1])).toContain('checked core/src/chunk.c lines 3');

    // Inner calls report through printed output, not the citation ledger.
    expect(sources).toEqual([]);
  });
});
