import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callerScope } from '../background/context.js';
import { chatScope } from '../chat-scope.js';
import { ContextStore } from '../context/store.js';
import { RequestCheckpoints } from './checkpoints.js';
import { keepResults, releaseResults } from './choices.js';
import { prepareRequest } from './prepare.js';
import { contextKeepsPath, currentSelection, emptySelection } from './selection.js';
import { contextControlTools } from './tools.js';
import { RequestUsage } from './usage.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const small = { provider: 'test', modelId: 'test', contextWindow: 12_000, cache: 'none' as const };
const big = (index: number) => `match ${index} `.repeat(200);
const statusTool = [{ type: 'function' as const, name: 'context_status', inputSchema: { type: 'object' as const } }];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'cberg-control-'));
  roots.push(root);

  return root;
}

/** `scoped` uses the current chat's selection, as the agent loop does. */
function setup(scoped = false) {
  const selection = emptySelection();
  const context = ContextStore.open(tempDir());
  const options = { profile: small, context, summarize: vi.fn(async () => 'Earlier work') };
  const deps = { options, checkpoints: new RequestCheckpoints(context, 'policy'), usage: new RequestUsage(), selection: scoped ? undefined : selection };

  return {
    deps,
    selection,
    prepare: async (input: LanguageModelV4CallOptions) => (await prepareRequest(input, deps)).request,
    notices: async (input: LanguageModelV4CallOptions) => ((await prepareRequest(input, deps)).notice ? 1 : 0),
  };
}

/** One turn of `count` grep steps, optionally offering context_status. */
function request(count: number, tools = false): LanguageModelV4CallOptions {
  const steps = Array.from({ length: count }, (_, index): LanguageModelV4Message[] => [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${index}`, toolName: 'grep', input: { index } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${index}`, toolName: 'grep', output: { type: 'text', value: big(index) } }] },
  ]).flat();

  return {
    prompt: [{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'where?' }] }, ...steps],
    ...(tools ? { tools: statusTool } : {}),
  };
}

/** Which results, in order, were sent as cleared pointers. */
function clearedFlags(call: LanguageModelV4CallOptions): boolean[] {
  return call.prompt.flatMap((message) => message.role === 'tool'
    ? message.content.flatMap((part) => part.type === 'tool-result' && part.output.type === 'text' ? [part.output.value.startsWith('[cleared ')] : [])
    : []);
}



describe('releasing and keeping tool results', () => {
  it('clears a released result from the next request, even while the context is small', async () => {
    const { prepare, selection } = setup();

    expect(clearedFlags(await prepare(request(3))).some(Boolean)).toBe(false);
    expect(await releaseResults(selection, ['c1'])).toMatchObject({ released: ['c1'] });

    expect(clearedFlags(await prepare(request(4)))).toEqual([false, true, false, false]);
  });

  it('keeps a kept result in full when the turn in progress is cleared', async () => {
    const { prepare, selection } = setup();

    expect(clearedFlags(await prepare(request(16))).slice(0, 8).every(Boolean)).toBe(true);

    await prepare(request(13));
    expect(await keepResults(selection, ['c2'])).toMatchObject({ kept: ['c2'], refused: [] });

    expect(clearedFlags(await prepare(request(16))).slice(0, 8)).toEqual([true, true, false, true, true, true, true, true]);
  });

  it('never brings back automatically cleared results after a release shrinks the request', async () => {
    const { prepare, selection } = setup();
    await prepare(request(16));

    // Enough to take the request back under the current-turn trigger.
    await releaseResults(selection, ['c10', 'c11', 'c12', 'c13']);
    const flags = clearedFlags(await prepare(request(16)));

    expect(flags.slice(0, 8).every(Boolean)).toBe(true);
    expect(flags.slice(10, 14).every(Boolean)).toBe(true);
  });

  it('refuses to keep cleared, unknown, or too many results, and to release small ones', async () => {
    const { prepare, selection } = setup();
    await prepare(request(16));

    const kept = await keepResults(selection, ['c0', 'nope', 'c8', 'c9', 'c10', 'c11']);

    expect(kept.kept).toEqual(['c8', 'c9', 'c10']);
    expect(kept.refused.map((refusal) => refusal.id)).toEqual(['c0', 'nope', 'c11']);
    expect(kept.refused[2]!.reason).toContain(`${kept.maxTokens} tokens`);

    selection.snapshot!.results[15]!.chars = 10;
    expect((await releaseResults(selection, ['c15'])).refused).toHaveLength(1);
    expect(selection.release.has('c15')).toBe(false);
  });

  it('un-keeps a released result', async () => {
    const { prepare, selection } = setup();
    await prepare(request(5));
    await keepResults(selection, ['c1']);

    await releaseResults(selection, ['c1']);

    expect(selection.keep.has('c1')).toBe(false);
    expect(clearedFlags(await prepare(request(5)))[1]).toBe(true);
  });
});

describe('kept slots and already-cleared results', () => {
  it('frees kept slots once their results leave the prompt', async () => {
    const { prepare, selection } = setup();
    await prepare(request(13));
    await keepResults(selection, ['c10', 'c11']);

    // A later prompt without those results, as after older history is summarized.
    await prepare(request(5));

    expect(selection.keep.size).toBe(0);
  });

  it('lets a kept result that left the prompt be released, freeing its slot', async () => {
    const { prepare, selection } = setup();
    await prepare(request(13));
    await keepResults(selection, ['c10']);
    selection.snapshot = { ...selection.snapshot!, results: [] };

    expect(await releaseResults(selection, ['c10'])).toMatchObject({ released: ['c10'], refused: [] });
    expect(selection.keep.has('c10')).toBe(false);
  });

  it('accepts releasing a result that was already cleared, without calling it small', async () => {
    const { prepare, selection } = setup();
    await prepare(request(16));

    expect(await releaseResults(selection, ['c0'])).toEqual({ released: ['c0'], refused: [], freedTokens: 0 });
    expect(selection.release.has('c0')).toBe(true);
  });
});

describe('context notices', () => {
  it('tells the agent once when usage crosses a higher level, only when it can check its context', async () => {
    const { notices } = setup();

    expect(await notices(request(3, true))).toBe(0);
    expect(await notices(request(13, true))).toBe(1);
    expect(await notices(request(13, true))).toBe(0);
    expect(await notices(request(16, true))).toBe(1);

    const other = setup();
    expect(await other.notices(request(16))).toBe(0);
  });
});

describe('context selections', () => {
  it('reports the last request through context_status and releases through the tools', async () => {
    const sessions = tempDir();
    writeFileSync(join(sessions, 'chat-a.json'), '{}');
    const chat = join(sessions, 'chat-a');
    const { prepare } = setup(true);
    const tools = contextControlTools();
    const run = (name: string, args: unknown) => chatScope.run(chat, () =>
      tools[name]!.execute!(args as never, { toolCallId: 't', messages: [], context: undefined })) as Promise<Record<string, unknown>>;

    await chatScope.run(chat, () => prepare(request(13)));
    const status = await run('context_status', {});

    expect(status).toMatchObject({ limits: { summarizeAt: 8_400, clearEarlierTurnsAt: 4_200, clearCurrentTurnAt: 6_300 }, results: { total: 13 } });
    expect((status.largest as Array<{ id: string; input: string }>)[0]).toMatchObject({ id: expect.stringMatching(/^c\d+$/), input: expect.stringContaining('index') });

    await run('context_release', { ids: ['c3'] });
    expect(clearedFlags(await chatScope.run(chat, () => prepare(request(13))))[3]).toBe(true);
    expect(JSON.parse(readFileSync(contextKeepsPath(join(chat, '..'), 'chat-a'), 'utf8')).agents[''].release).toEqual(['c3']);
  });

  it('loads a chat’s saved choices and keeps each subagent’s apart', async () => {
    const sessions = tempDir();
    mkdirSync(join(sessions, '.context-keeps'));
    writeFileSync(contextKeepsPath(sessions, 'saved'), JSON.stringify({ version: 1, agents: { '': { keep: ['c1'], release: ['c2'] } } }));

    const main = await chatScope.run(join(sessions, 'saved'), () => currentSelection());
    const subagent = await chatScope.run(join(sessions, 'saved'), () => callerScope.run('agent-1', () => currentSelection()));

    expect([...main.keep]).toEqual(['c1']);
    expect([...main.release]).toEqual(['c2']);
    expect(subagent.keep.size).toBe(0);
    expect(existsSync(contextKeepsPath(sessions, 'other'))).toBe(false);
  });
});

it('does not recreate keep/release choices for a deleted chat', async () => {
  const sessions = tempDir();
  const chat = join(sessions, 'gone');

  const selection = await chatScope.run(chat, () => currentSelection());
  selection.keep.add('c1');
  await selection.save();

  expect(existsSync(contextKeepsPath(sessions, 'gone'))).toBe(false);
});
