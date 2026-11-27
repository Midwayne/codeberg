import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { callerScope } from '../background/context.js';
import { chatScope } from '../chat-scope.js';
import { withWorklistScope } from './store.js';
import { worklistTools } from './tools.js';
import type { WorklistEntry } from './types.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function sessionsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codeberg-worklist-'));
  dirs.push(dir);

  return dir;
}

/** A saved chat's directory key; its record must exist for the list to be saved. */
function chatIn(dir: string, id: string): string {
  writeFileSync(join(dir, `${id}.json`), '{}');

  return join(dir, id);
}

type Result = Record<string, unknown> & { entries?: WorklistEntry[] };

/** Run a working-list tool the way a browser chat run does: inside its chat scope. */
async function call(chat: string | undefined, name: string, args: unknown): Promise<Result> {
  const tool = worklistTools()[name]!;
  const run = () => tool.execute!(args as never, { toolCallId: 'call_0', messages: [], context: undefined }) as Promise<Result>;

  return chat === undefined ? run() : chatScope.run(chat, run);
}

const texts = (result: Result) => result.entries!.map((entry) => entry.text);

it('keeps entries for later calls in the same chat and saves them beside the chat', async () => {
  const dir = sessionsDir();
  const chat = chatIn(dir, 'chat-a');

  await call(chat, 'worklist_add', { items: [{ text: 'Chunker entry point is core/src/chunk.c:12-40', tags: ['Finding'] }] });
  await call(chat, 'worklist_add', { items: [{ text: 'User wants answers in British English', tags: ['constraint'] }] });

  const read = await call(chat, 'worklist_read', {});

  expect(texts(read)).toEqual(['Chunker entry point is core/src/chunk.c:12-40', 'User wants answers in British English']);
  expect(read.entries!.map((entry) => entry.id)).toEqual(['w1', 'w2']);
  expect(read.entries![0]!.tags).toEqual(['finding']);

  const saved = JSON.parse(readFileSync(join(dir, '.worklists', 'chat-a.json'), 'utf8'));
  expect(saved.entries).toHaveLength(2);
});

it('returns the existing id instead of recording the same active text twice', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');

  await call(chat, 'worklist_add', { items: [{ text: 'Index path comes from CBERG_INDEX_PATH' }] });
  const again = await call(chat, 'worklist_add', { items: [{ text: '  Index path comes from CBERG_INDEX_PATH ' }] });

  expect(again).toMatchObject({ added: [], duplicates: [{ id: 'w1' }] });
  expect((await call(chat, 'worklist_read', {})).matched).toBe(1);
});

it('greps entries by substring, regular expression, and tag', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [
    { text: 'Daemon listens on port 8080', tags: ['config'] },
    { text: 'Embedding model is jina v2', tags: ['finding'] },
    { text: 'Tests run with ctest' },
  ] });

  expect(texts(await call(chat, 'worklist_read', { pattern: 'DAEMON' }))).toEqual(['Daemon listens on port 8080']);
  expect(texts(await call(chat, 'worklist_read', { pattern: 'port \\d+|ctest', regex: true })))
    .toEqual(['Daemon listens on port 8080', 'Tests run with ctest']);
  expect(texts(await call(chat, 'worklist_read', { tag: 'finding' }))).toEqual(['Embedding model is jina v2']);
  expect(texts(await call(chat, 'worklist_read', { pattern: 'config' }))).toEqual(['Daemon listens on port 8080']);
  await expect(call(chat, 'worklist_read', { pattern: '(', regex: true })).rejects.toThrow('Invalid regular expression');
});

it('stops a regular expression that backtracks without end instead of freezing the server', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: `${'a'.repeat(40)}b` }] });

  const started = performance.now();

  await expect(call(chat, 'worklist_read', { pattern: '(a|aa)+$', regex: true })).rejects.toThrow('took too long');
  expect(performance.now() - started).toBeLessThan(2_000);
});

it('gives each terminal conversation its own list, kept across its turns', async () => {
  const first = {};
  const second = {};
  const turn = <T>(list: object, action: () => Promise<T>) => withWorklistScope(list, action);

  await turn(first, () => call(undefined, 'worklist_add', { items: [{ text: 'First conversation finding' }] }));
  await turn(second, () => call(undefined, 'worklist_add', { items: [{ text: 'Second conversation finding' }] }));

  expect(texts(await turn(first, () => call(undefined, 'worklist_read', {})))).toEqual(['First conversation finding']);
  expect(texts(await turn(second, () => call(undefined, 'worklist_read', {})))).toEqual(['Second conversation finding']);
});

it('keeps the most recent matches when a limit cuts the list', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] });

  const read = await call(chat, 'worklist_read', { limit: 2 });

  expect(texts(read)).toEqual(['two', 'three']);
  expect(read).toMatchObject({ matched: 3, note: expect.any(String) });
});

it('hides a retired entry by default and links it to its correction', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: 'Default port is 9090', tags: ['config'] }] });

  const retired = await call(chat, 'worklist_retire', { id: 'w1', reason: 'read config.go', correction: 'Default port is 8080' });

  expect(retired).toMatchObject({ retired: { id: 'w1', retired: { reason: 'read config.go', replacedBy: 'w2' } }, correction: { id: 'w2', tags: ['config'] } });
  expect(texts(await call(chat, 'worklist_read', {}))).toEqual(['Default port is 8080']);
  expect(texts(await call(chat, 'worklist_read', { include_retired: true }))).toEqual(['Default port is 9090', 'Default port is 8080']);
  await expect(call(chat, 'worklist_retire', { id: 'w1' })).rejects.toThrow('already retired');
  await expect(call(chat, 'worklist_retire', { id: 'w9' })).rejects.toThrow('No working-list entry w9');
});

it('loses no entry when parallel tool calls record at once', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');

  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    call(chat, 'worklist_add', { items: [{ text: `fact ${index}` }] })));

  const read = await call(chat, 'worklist_read', {});

  expect(read.matched).toBe(12);
  expect(new Set(read.entries!.map((entry) => entry.id)).size).toBe(12);
});

it('keeps each chat’s list separate and records which subagent added an entry', async () => {
  const dir = sessionsDir();

  chatIn(dir, 'chat-a');
  chatIn(dir, 'chat-b');
  await callerScope.run('agent-3', () => call(join(dir, 'chat-a'), 'worklist_add', { items: [{ text: 'from a subagent' }] }));
  await call(join(dir, 'chat-b'), 'worklist_add', { items: [{ text: 'from chat b' }] });

  const a = await call(join(dir, 'chat-a'), 'worklist_read', {});

  expect(texts(a)).toEqual(['from a subagent']);
  expect(a.entries![0]!.by).toBe('agent-3');
  expect(texts(await call(join(dir, 'chat-b'), 'worklist_read', {}))).toEqual(['from chat b']);
});

it('keeps a terminal run’s list in memory across calls', async () => {
  await call(undefined, 'worklist_add', { items: [{ text: 'terminal fact' }] });

  expect(texts(await call(undefined, 'worklist_read', { pattern: 'terminal fact' }))).toEqual(['terminal fact']);
});

it('refuses empty, oversized, and too many items', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');

  await expect(call(chat, 'worklist_add', { items: [{ text: '   ' }] })).rejects.toThrow('non-empty');
  await expect(call(chat, 'worklist_add', { items: [{ text: 'x'.repeat(2_001) }] })).rejects.toThrow('under 2000');
  await expect(call(chat, 'worklist_add', { items: Array.from({ length: 21 }, (_, i) => ({ text: `${i}` })) })).rejects.toThrow('at most 20');
  expect((await call(chat, 'worklist_read', {})).matched).toBe(0);
});

it('reads the list even when a parallel update fails', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: 'kept fact' }] });

  const [retire, read] = await Promise.allSettled([
    call(chat, 'worklist_retire', { id: 'w99' }),
    call(chat, 'worklist_read', {}),
  ]);

  expect(retire.status).toBe('rejected');
  expect(read.status === 'fulfilled' && texts(read.value)).toEqual(['kept fact']);
});

it('saves the items that fit when the list fills mid-call and refuses a correction past the limit', async () => {
  const chat = chatIn(sessionsDir(), 'chat-a');
  for (let batch = 0; batch < 24; batch++) {
    await call(chat, 'worklist_add', { items: Array.from({ length: 20 }, (_, i) => ({ text: `fact ${batch}-${i}` })) });
  }
  await call(chat, 'worklist_add', { items: Array.from({ length: 18 }, (_, i) => ({ text: `last ${i}` })) });

  const full = await call(chat, 'worklist_add', { items: [{ text: 'fits 1' }, { text: 'fits 2' }, { text: 'too many' }] });

  expect(full).toMatchObject({ notAdded: ['too many'], note: expect.stringContaining('full') });
  expect((await call(chat, 'worklist_read', { pattern: 'fits' })).matched).toBe(2);
  await expect(call(chat, 'worklist_retire', { id: 'w1', correction: 'better fact' })).rejects.toThrow('full');
  expect((await call(chat, 'worklist_retire', { id: 'w1' })).retired).toMatchObject({ id: 'w1' });
});

it('does not recreate the list of a deleted chat', async () => {
  const dir = sessionsDir();
  const chat = chatIn(dir, 'chat-a');
  rmSync(join(dir, 'chat-a.json'));

  await expect(call(chat, 'worklist_add', { items: [{ text: 'late fact' }] })).rejects.toThrow('deleted');
  expect(() => readFileSync(join(dir, '.worklists', 'chat-a.json'))).toThrow();
});
