import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';

import { WebSessionStore } from '../sessions/store.js';
import { SearchRuns } from './manager.js';
import { RunJournal } from './journal.js';
import { recordToolExecutions } from '../../core/runs/tools.js';
import type { ChatGenerator } from './types.js';

const dirs: string[] = [];
const messages: UIMessage[] = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }];
const input = { chatId: 'chat', requestId: 'request', messages };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'codeberg-search-runs-'));
  dirs.push(dir);
  const sessions = new WebSessionStore(dir);
  let sink!: ReadableStreamDefaultController<UIMessageChunk>;
  let signal!: AbortSignal;
  const generate = vi.fn<ChatGenerator>(async (options) => {
    signal = options.signal;
    return { stream: new ReadableStream({ start(controller) { sink = controller; } }) };
  });
  const runs = new SearchRuns(sessions, generate);

  return { sessions, runs, generate, sink: () => sink, signal: () => signal };
}

async function textRun(f: Awaited<ReturnType<typeof fixture>>) {
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  f.sink().enqueue({ type: 'start', messageId: 'a1' });
  f.sink().enqueue({ type: 'text-start', id: 't1' });
  f.sink().enqueue({ type: 'text-delta', id: 't1', delta: 'Found src/auth.ts' });
  f.sink().enqueue({ type: 'text-end', id: 't1' });
  f.sink().enqueue({ type: 'finish', finishReason: 'stop' });
  f.sink().close();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('continues after a subscriber disconnects, replays only missing chunks, and saves without a browser', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  const reader = f.runs.stream(run).getReader();
  await textRun(f);
  expect((await reader.read()).value).toMatchObject({ type: 'start' });
  await reader.cancel();
  await run.done;

  expect(f.signal().aborted).toBe(false);
  const replay: UIMessageChunk[] = [];
  for await (const chunk of f.runs.stream(run, 1)) replay.push(chunk);
  expect(replay.map((chunk) => chunk.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish']);
  expect((await f.sessions.load('chat'))?.messages.at(-1)).toMatchObject({
    id: 'a1', parts: [{ type: 'text', text: 'Found src/auth.ts', state: 'done' }],
  });
  expect((await f.runs.find('chat', run.record.id))?.record.status).toBe('completed');
});

it('deduplicates concurrent submissions and rejects conflicting requests from another tab', async () => {
  const f = await fixture();
  const [first, duplicate] = await Promise.all([f.runs.admit(input), f.runs.admit(input)]);
  expect(duplicate.record.id).toBe(first.record.id);
  await expect(f.runs.admit({ ...input, requestId: 'other' })).rejects.toMatchObject({ status: 409 });
  await expect(f.runs.admit({ ...input, messages: [] })).rejects.toMatchObject({ status: 409 });
  await textRun(f);
  await first.done;
  const retry = await f.runs.admit(input);
  expect(retry.record.id).toBe(first.record.id);
  expect(f.generate).toHaveBeenCalledOnce();
});

it('explicit Stop aborts generation and persists a stopped status', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  await f.runs.stop('chat', run.record.id);
  expect(f.signal().aborted).toBe(true);
  expect(run.record.status).toBe('stopped');
  expect((await f.sessions.load('chat'))?.messages).toEqual(messages);
});

it('does not let an older tab overwrite server-owned results or submit stale history', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  await textRun(f);
  await run.done;
  await f.sessions.upsert({ id: 'chat', title: 'stale', messages });
  expect((await f.sessions.load('chat'))?.messages).toHaveLength(2);
  await expect(f.runs.admit({ ...input, requestId: 'new' })).rejects.toMatchObject({ status: 409 });
});

it('marks an orphaned run interrupted after restart and never repeats a possibly completed tool', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  // This is the durable state left by a dead process after executing a tool,
  // but before its completion record reaches disk.
  await run.journal.append({ kind: 'tool', id: 'tool-1', name: 'get_chunk', state: 'started', input: { id: 7 } });
  const restartedGenerator = vi.fn<ChatGenerator>();
  const restarted = new SearchRuns(f.sessions, restartedGenerator);
  await restarted.initialize();
  const recovered = await restarted.find('chat', run.record.id);
  expect(recovered?.record.status).toBe('interrupted');
  expect(recovered?.tools).toEqual([expect.objectContaining({ id: 'tool-1', state: 'started' })]);
  expect(restartedGenerator).not.toHaveBeenCalled();
  // Dispose the simulated old process without writing over recovered state.
  f.sink().error(new Error('simulated process death'));
  await run.done;
});

it('records completed tool outcomes before returning them, leaving uncertainty when persistence fails', async () => {
  const f = await fixture();
  const execute = vi.fn(async () => ({ body: 'function auth() {}' }));
  const original = RunJournal.prototype.append;
  vi.spyOn(RunJournal.prototype, 'append').mockImplementation(async function (this: RunJournal, event) {
    if (event.kind === 'tool' && event.state === 'completed') throw new Error('disk full');
    return original.call(this, event);
  });
  const generate: ChatGenerator = async () => {
    const tools = recordToolExecutions({ get_chunk: { execute } } as any);
    await (tools.get_chunk.execute as any)({ id: 7 }, { toolCallId: 'tool-1' });
    return { stream: new ReadableStream({ start(controller) { controller.close(); } }) };
  };
  const runs = new SearchRuns(f.sessions, generate);
  const run = await runs.admit(input);
  await run.done;
  expect(execute).toHaveBeenCalledOnce();
  expect(run.record.status).toBe('failed');
  const loaded = await runs.find('chat', run.record.id);
  expect(loaded?.tools).toEqual([expect.objectContaining({ state: 'started' })]);
});

it('repairs an incomplete final journal write before saving restart observations', async () => {
  const { appendFile, readFile } = await import('node:fs/promises');
  const f = await fixture();
  const run = await f.runs.admit(input);
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
  await run.journal.append({ kind: 'tool', id: 'completed', name: 'get_chunk', state: 'started' });
  await run.journal.append({ kind: 'tool', id: 'completed', name: 'get_chunk', state: 'completed', output: { body: 'auth' } });
  await appendFile(join(run.journal.directory, 'events.jsonl'), '{"kind":"tool","state":"compl');
  const restarted = new SearchRuns(f.sessions, vi.fn<ChatGenerator>());
  await restarted.initialize();
  const loaded = await restarted.find('chat', run.record.id);
  expect(loaded?.record.status).toBe('interrupted');
  expect(loaded?.tools.at(-1)).toMatchObject({ state: 'completed', output: { body: 'auth' } });
  expect((await readFile(join(run.journal.directory, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).every((line) => JSON.parse(line))).toBe(true);
  f.sink().error(new Error('simulated process death'));
  await run.done;
});

it('rebuilds the transcript if a process died after terminal status but before the chat snapshot was saved', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  await textRun(f);
  await run.done;
  const saved = (await f.sessions.load('chat'))!;
  await f.sessions.save({ ...saved, messages });
  const restarted = new SearchRuns(f.sessions, vi.fn<ChatGenerator>());
  await restarted.initialize();
  expect((await f.sessions.load('chat'))?.messages).toHaveLength(2);
});

it('does not refresh completed chats timestamps merely because the server restarted', async () => {
  const f = await fixture();
  const run = await f.runs.admit(input);
  await textRun(f);
  await run.done;
  await f.sessions.save({ ...(await f.sessions.load('chat'))!, updatedAt: 10 });
  const restarted = new SearchRuns(f.sessions, vi.fn<ChatGenerator>());
  await restarted.initialize();
  expect((await f.sessions.load('chat'))?.updatedAt).toBe(10);
});
