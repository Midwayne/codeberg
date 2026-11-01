import { jsonSchema, tool } from 'ai';
import { expect, it, vi } from 'vitest';
import { backgroundTools } from './tools.js';
import { backgroundContext } from './context.js';
import { scheduleContext } from '../schedules/context.js';

const options = { toolCallId: 'start', messages: [], abortSignal: new AbortController().signal };

it('starts any ordinary tool using a job-owned signal and preserves its arguments', async () => {
  const execute = vi.fn(async (_args, _options) => ({ done: true }));
  const jobs = { start: vi.fn(async (_owner, _input, run) => {
    const controller = new AbortController();
    await run(controller.signal);
    return { ...owner(), id: 'job', tool: 'example', status: 'running' as const, createdAt: 1 };
  }), get: vi.fn(), cancel: vi.fn(), list: vi.fn() };
  const tools = backgroundTools({ example: tool({ inputSchema: jsonSchema({ type: 'object' }), execute }) });

  await backgroundContext.run({ ...owner(), jobs, sleeping: false }, () =>
    (tools.start_background_tool.execute as any)({ tool: 'example', args: { value: 42 } }, options));
  expect(execute).toHaveBeenCalledWith({ value: 42 }, expect.objectContaining({ toolCallId: expect.any(String) }));
  expect(execute.mock.calls[0]![1].abortSignal).not.toBe(options.abortSignal);
});

function owner() {
  return { chatId: 'chat', sourceRunId: 'turn' };
}

it('saves a wake-up before stopping the turn and permits adaptive checks without a new user request', async () => {
  const create = vi.fn(async (_scope, input) => ({ id: 'wake', ...input }));
  const get = vi.fn(async () => ({ ...owner(), id: 'job', tool: 'example', args: {}, fingerprint: '', createdAt: 1, status: 'running' as const }));
  const scope = { ...owner(), jobs: { start: vi.fn(), get, cancel: vi.fn(), list: vi.fn() }, sleeping: false };
  const tools = backgroundTools({});
  const scheduler = { create, list: vi.fn(), cancel: vi.fn() };

  await scheduleContext.run({ ...owner(), scheduler }, () => backgroundContext.run(scope, async () => {
    await (tools.sleep_agent.execute as any)({ delay_seconds: 120, prompt: 'Check job, sleep again if needed', job_ids: ['job'] }, options);
    expect(scope.sleeping).toBe(true);
  }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining(owner()), expect.objectContaining({ delay_seconds: 120, background_job_ids: ['job'] }));
  expect(get).toHaveBeenCalledWith('chat', 'job');
});

it('does not stop the turn if saving the wake-up fails and blocks control-tool recursion', async () => {
  const tools = backgroundTools({});
  const scope = { ...owner(), jobs: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), list: vi.fn() }, sleeping: false };
  const scheduler = { create: vi.fn(async () => { throw new Error('disk full'); }), list: vi.fn(), cancel: vi.fn() };
  await scheduleContext.run({ ...owner(), scheduler }, () => backgroundContext.run(scope, async () => {
    await expect((tools.sleep_agent.execute as any)({ delay_seconds: 60, prompt: 'Check later' }, options)).rejects.toThrow('disk full');
    expect(scope.sleeping).toBe(false);
    await expect((tools.start_background_tool.execute as any)({ tool: 'sleep_agent', args: {} }, options)).rejects.toThrow('control');
  }));
});
