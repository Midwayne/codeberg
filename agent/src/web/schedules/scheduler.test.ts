import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { SearchRuns } from '../runs/manager.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ChatGenerator } from '../runs/types.js';
import { scheduleContext } from '../../core/schedules/context.js';
import { scheduleToolSource } from '../../core/schedules/tools.js';

const dirs: string[] = [];
const owners: SearchRuns[] = [];

afterEach(async () => {
  await Promise.all(owners.splice(0).map((runs) => runs.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture(generate?: ChatGenerator) {
  const dir = await mkdtemp(join(tmpdir(), 'codeberg-schedules-'));
  dirs.push(dir);
  const sessions = new WebSessionStore(dir);
  await sessions.upsert({ id: 'chat', title: 'Scheduled chat', messages: [
    { id: 'original', role: 'user', parts: [{ type: 'text', text: 'Investigate' }] },
  ] });
  const generator = vi.fn<ChatGenerator>(generate ?? (async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'start', messageId: 'answer' });
    controller.enqueue({ type: 'finish', finishReason: 'stop' });
    controller.close();
  } }) })));
  const runs = new SearchRuns(sessions, generator);
  owners.push(runs);

  return { runs, sessions, generator, scheduler: runs.schedules,
    context: { chatId: 'chat', sourceRunId: 'origin', selection: undefined } };
}

it('persists a one-time wake-up across restart and dispatches once with latest history', async () => {
  const f = await fixture();
  const job = await f.scheduler.create(f.context, { prompt: 'Check again', delay_seconds: 60 });
  await f.runs.close();
  await f.sessions.upsert({ id: 'chat', title: 'Scheduled chat', messages: [
    ...(await f.sessions.load('chat'))!.messages,
    { id: 'new', role: 'user', parts: [{ type: 'text', text: 'Also check retries' }] },
  ] });

  const restarted = new SearchRuns(f.sessions, f.generator);
  owners.push(restarted);
  await restarted.schedules.tick(job.dueAt! - 1);
  expect(f.generator).not.toHaveBeenCalled();
  await restarted.schedules.tick(job.dueAt!);
  await (await restarted.find('chat'))!.done;
  await restarted.schedules.tick(job.dueAt! + 1);
  await restarted.schedules.tick(job.dueAt! + 2);

  expect(f.generator).toHaveBeenCalledOnce();
  expect(f.generator.mock.calls[0]![0].messages).toHaveLength(3);
  expect(f.generator.mock.calls[0]![0].messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'Check again' }]);
  expect((await restarted.schedules.list('chat'))[0]?.status).toBe('completed');
});

it('coalesces missed intervals and never overlaps an active chat', async () => {
  let sink!: ReadableStreamDefaultController<UIMessageChunk>;
  const f = await fixture(async () => ({ stream: new ReadableStream({ start(controller) { sink = controller; } }) }));
  const active = await f.runs.admit({ chatId: 'chat', requestId: 'manual', messages: (await f.sessions.load('chat'))!.messages });
  await vi.waitFor(() => expect(f.generator).toHaveBeenCalledOnce());
  const job = await f.scheduler.create(f.context, { prompt: 'Poll', delay_seconds: 1, every_seconds: 60 });

  await f.scheduler.tick(job.dueAt! + 600_000);
  expect(f.generator).toHaveBeenCalledOnce();
  sink.enqueue({ type: 'finish', finishReason: 'stop' });
  sink.close();
  await active.done;
  await f.scheduler.tick(job.dueAt! + 600_000);
  await vi.waitFor(() => expect(f.generator).toHaveBeenCalledTimes(2));
  sink.enqueue({ type: 'finish', finishReason: 'stop' });
  sink.close();
  await (await f.runs.find('chat'))!.done;
  await f.scheduler.tick(job.dueAt! + 600_000);

  const stored = (await f.scheduler.list('chat'))[0]!;
  expect(stored.status).toBe('scheduled');
  expect(stored.dueAt).toBeGreaterThan(job.dueAt! + 600_000);
  expect(f.generator).toHaveBeenCalledTimes(2);
});

it('cancels only schedules owned by this chat and survives restart', async () => {
  const f = await fixture();
  const job = await f.scheduler.create(f.context, { prompt: 'Later', delay_seconds: 1 });
  await expect(f.scheduler.cancel('other-chat', job.id)).rejects.toThrow('not found');
  await f.scheduler.cancel('chat', job.id);
  await f.scheduler.tick(job.dueAt! + 1);

  expect(f.generator).not.toHaveBeenCalled();
  expect((await f.scheduler.list('other-chat'))).toEqual([]);
  expect((await f.scheduler.list('chat'))[0]?.status).toBe('cancelled');
});

it('does not resurrect deleted chats or execute during maintenance', async () => {
  const f = await fixture();
  const job = await f.scheduler.create(f.context, { prompt: 'Later', delay_seconds: 1 });
  f.scheduler.canDispatch = () => false;
  await f.scheduler.tick(job.dueAt! + 1);
  expect(f.generator).not.toHaveBeenCalled();

  f.scheduler.canDispatch = () => true;
  await f.sessions.remove('chat');
  await f.scheduler.tick(job.dueAt! + 1);
  expect(f.generator).not.toHaveBeenCalled();
  expect((await f.scheduler.list('chat'))[0]?.status).toBe('cancelled');
});

it('injects a chat-scoped scheduling context into normal and scheduled generation', async () => {
  const contexts: unknown[] = [];
  const f = await fixture(async () => {
    contexts.push(scheduleContext.getStore());
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    } }) };
  });
  const active = await f.runs.admit({ chatId: 'chat', requestId: 'manual', messages: (await f.sessions.load('chat'))!.messages });
  await active.done;
  expect(contexts[0]).toMatchObject({ chatId: 'chat', sourceRunId: active.record.id, scheduler: f.scheduler });

  const job = await f.scheduler.create(f.context, { prompt: 'Later', delay_seconds: 1 });
  await f.scheduler.tick(job.dueAt!);
  await (await f.runs.find('chat'))!.done;
  expect(contexts[1]).toMatchObject({ chatId: 'chat', scheduler: f.scheduler });
});

it('reconciles admission after a crash without replaying the scheduled turn', async () => {
  const f = await fixture();
  const job = await f.scheduler.create(f.context, { prompt: 'Only once', delay_seconds: 1 });
  await f.scheduler.tick(job.dueAt!);
  await (await f.runs.find('chat'))!.done;
  // Disk still says running: simulate a crash before the next reconciliation.
  expect((await f.scheduler.list('chat'))[0]?.status).toBe('running');
  await f.runs.close();
  const restarted = new SearchRuns(f.sessions, f.generator);
  owners.push(restarted);
  await restarted.schedules.tick(job.dueAt! + 1);

  expect(f.generator).toHaveBeenCalledOnce();
  expect((await restarted.schedules.list('chat'))[0]?.status).toBe('completed');
});

it('recovers a reservation that crashed before run admission', async () => {
  const f = await fixture();
  const job = await f.scheduler.create(f.context, { prompt: 'Reserved', delay_seconds: 1 });
  await f.scheduler.store.write([{ ...job, status: 'running' }]);
  await f.runs.close();
  const restarted = new SearchRuns(f.sessions, f.generator);
  owners.push(restarted);
  await restarted.schedules.tick(job.dueAt!);
  await (await restarted.find('chat'))!.done;
  await restarted.schedules.tick(job.dueAt! + 1);

  expect(f.generator).toHaveBeenCalledOnce();
  expect((await restarted.schedules.list('chat'))[0]?.status).toBe('completed');
});

it('dispatches an absolute timestamp using its explicit timezone', async () => {
  const f = await fixture();
  const timestamp = new Date(Date.now() + 60_000).toISOString();
  const job = await f.scheduler.create(f.context, { prompt: 'At that time', run_at: timestamp });
  expect(job.dueAt).toBe(Date.parse(timestamp));

  await f.scheduler.tick(job.dueAt!);
  await (await f.runs.find('chat'))!.done;
  expect(f.generator).toHaveBeenCalledOnce();
});

it('dispatches from its server timer without a browser request', async () => {
  const f = await fixture();
  await f.scheduler.create(f.context, { prompt: 'Wake up', delay_seconds: 0.001 });
  f.scheduler.start();
  await vi.waitFor(() => expect(f.generator).toHaveBeenCalledOnce(), { timeout: 2500 });
  await (await f.runs.find('chat'))!.done;
});

it('preserves the selected model and stops recurring schedules after a failed turn', async () => {
  const f = await fixture(async () => { throw new Error('Provider unavailable'); });
  const selection = { key: 'test:model', model: 'test:model', effort: 'provider-default' as const, contextWindow: 8192 };
  const job = await f.scheduler.create({ ...f.context, selection }, { prompt: 'Later', delay_seconds: 1, every_seconds: 60 });
  await f.scheduler.tick(job.dueAt!);
  await (await f.runs.find('chat'))!.done;
  await f.scheduler.tick(job.dueAt! + 600_000);

  expect(f.generator).toHaveBeenCalledOnce();
  expect(f.generator.mock.calls[0]![0].selection).toEqual(selection);
  expect((await f.scheduler.list('chat'))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Provider unavailable') });
});

it('allows generation to schedule and cancel follow-ups through tools without locking the worker', async () => {
  let first = true;
  const f = await fixture(async () => {
    if (first) {
      first = false;
      const tools = await scheduleToolSource().tools();
      const invoke = (name: string, value: unknown) => (tools[name]!.execute as any)(value, { toolCallId: name });
      const created = await invoke('schedule_run', { prompt: 'Inspect again', delay_seconds: 1 });
      expect(await invoke('list_scheduled_runs', {})).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
      await invoke('cancel_scheduled_run', { id: created.id });
    }

    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    } }) };
  });
  const job = await f.scheduler.create(f.context, { prompt: 'Start', delay_seconds: 1 });
  await f.scheduler.tick(job.dueAt!);
  await (await f.runs.find('chat'))!.done;
  expect((await f.scheduler.list('chat')).some((item) => item.status === 'cancelled')).toBe(true);

  const tools = await scheduleToolSource().tools();
  expect(() => (tools.list_scheduled_runs!.execute as any)({}, {})).toThrow('server-owned browser chat');
});

it('wakes after a durable tool outcome and reports uncertainty without re-executing tools', async () => {
  const f = await fixture();
  const source = await f.runs.admit({ chatId: 'chat', requestId: 'source', messages: (await f.sessions.load('chat'))!.messages });
  await source.done;
  const completed = { kind: 'tool' as const, id: 'tool-one', name: 'external_job', state: 'completed' as const, output: { result: 'ready' } };
  await source.journal.append(completed);
  const job = await f.scheduler.create({ ...f.context, sourceRunId: source.record.id }, {
    prompt: 'Review its result', after_tool_call_id: 'tool-one',
  });
  await f.scheduler.tick();
  await (await f.runs.find('chat'))!.done;
  await f.scheduler.tick();
  expect(f.generator).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(f.generator.mock.calls[1]![0].messages.at(-1))).toContain('ready');
  expect((await f.scheduler.list('chat')).find((item) => item.id === job.id)?.status).toBe('completed');

  const uncertain = await f.scheduler.create({ ...f.context, sourceRunId: source.record.id }, {
    prompt: 'Do not guess', after_tool_call_id: 'unknown-tool',
  });
  await f.scheduler.tick();
  expect((await f.scheduler.list('chat')).find((item) => item.id === uncertain.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('outcome') });
  expect(f.generator).toHaveBeenCalledTimes(2);
});

it.each([
  { prompt: 'x' },
  { prompt: ' ', delay_seconds: 1 },
  { prompt: 'x', delay_seconds: -1 },
  { prompt: 'x', run_at: 'tomorrow' },
  { prompt: 'x', run_at: '2027-01-01T10:00:00' },
  { prompt: 'x', delay_seconds: 1, run_at: '2027-01-01T10:00:00Z' },
  { prompt: 'x', delay_seconds: 1, every_seconds: 1 },
  { prompt: 'x', after_tool_call_id: 'a', every_seconds: 60 },
])('rejects invalid schedules: %j', async (input) => {
  const f = await fixture();
  await expect(f.scheduler.create(f.context, input)).rejects.toThrow();
  expect(await f.scheduler.list('chat')).toEqual([]);
});
