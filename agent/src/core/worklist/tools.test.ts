import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { callerScope } from '../background/context.js';
import { chatScope } from '../chat-scope.js';
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
  const chat = join(dir, 'chat-a');

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
  const chat = join(sessionsDir(), 'chat-a');

  await call(chat, 'worklist_add', { items: [{ text: 'Index path comes from CBERG_INDEX_PATH' }] });
  const again = await call(chat, 'worklist_add', { items: [{ text: '  Index path comes from CBERG_INDEX_PATH ' }] });

  expect(again).toMatchObject({ added: [], duplicates: [{ id: 'w1' }] });
  expect((await call(chat, 'worklist_read', {})).matched).toBe(1);
});

it('greps entries by substring, regular expression, and tag', async () => {
  const chat = join(sessionsDir(), 'chat-a');
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

it('keeps the most recent matches when a limit cuts the list', async () => {
  const chat = join(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] });

  const read = await call(chat, 'worklist_read', { limit: 2 });

  expect(texts(read)).toEqual(['two', 'three']);
  expect(read).toMatchObject({ matched: 3, note: expect.any(String) });
});

it('hides a retired entry by default and links it to its correction', async () => {
  const chat = join(sessionsDir(), 'chat-a');
  await call(chat, 'worklist_add', { items: [{ text: 'Default port is 9090', tags: ['config'] }] });

  const retired = await call(chat, 'worklist_retire', { id: 'w1', reason: 'read config.go', correction: 'Default port is 8080' });

  expect(retired).toMatchObject({ retired: { id: 'w1', retired: { reason: 'read config.go', replacedBy: 'w2' } }, correction: { id: 'w2', tags: ['config'] } });
  expect(texts(await call(chat, 'worklist_read', {}))).toEqual(['Default port is 8080']);
  expect(texts(await call(chat, 'worklist_read', { include_retired: true }))).toEqual(['Default port is 9090', 'Default port is 8080']);
  await expect(call(chat, 'worklist_retire', { id: 'w1' })).rejects.toThrow('already retired');
  await expect(call(chat, 'worklist_retire', { id: 'w9' })).rejects.toThrow('No working-list entry w9');
});

it('loses no entry when parallel tool calls record at once', async () => {
  const chat = join(sessionsDir(), 'chat-a');

  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    call(chat, 'worklist_add', { items: [{ text: `fact ${index}` }] })));

  const read = await call(chat, 'worklist_read', {});

  expect(read.matched).toBe(12);
  expect(new Set(read.entries!.map((entry) => entry.id)).size).toBe(12);
});

it('keeps each chat’s list separate and records which subagent added an entry', async () => {
  const dir = sessionsDir();

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
  const chat = join(sessionsDir(), 'chat-a');

  await expect(call(chat, 'worklist_add', { items: [{ text: '   ' }] })).rejects.toThrow('non-empty');
  await expect(call(chat, 'worklist_add', { items: [{ text: 'x'.repeat(2_001) }] })).rejects.toThrow('under 2000');
  await expect(call(chat, 'worklist_add', { items: Array.from({ length: 21 }, (_, i) => ({ text: `${i}` })) })).rejects.toThrow('at most 20');
  expect((await call(chat, 'worklist_read', {})).matched).toBe(0);
});
