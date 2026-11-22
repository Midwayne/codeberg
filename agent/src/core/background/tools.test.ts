import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { expect, it, vi } from 'vitest';
import { backgroundTools } from './tools.js';
import { sleepEndsTurn, withSleepNote } from './sleep.js';
import { backgroundContext, beginAgentStep, callerScope, detachedCallId, noteForegroundSubagents, subagentsThisStep } from './context.js';
import { scheduleContext } from '../schedules/context.js';
import { ContextStore } from '../context/store.js';
import { wrapToolOutputs } from '../context/wrap.js';

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

it('refuses to sleep past foreground subagent reports and withdraws the saved wake-up', async () => {
  const tools = backgroundTools({});
  const scope = { ...owner(), jobs: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), list: vi.fn() }, sleeping: false };
  const scheduler = { create: vi.fn(async () => ({ id: 'wake' })), list: vi.fn(), cancel: vi.fn(async () => ({})) };

  await scheduleContext.run({ ...owner(), scheduler }, () => backgroundContext.run(scope, async () => {
    noteForegroundSubagents('fan');

    await expect((tools.sleep_agent.execute as any)({ delay_seconds: 60, prompt: 'Check later' }, options))
      .rejects.toThrow('start_background_tool');

    expect(scope.sleeping).toBe(false);
    expect(scheduler.cancel).toHaveBeenCalledWith('chat', 'wake');

    beginAgentStep();

    await (tools.sleep_agent.execute as any)({ delay_seconds: 60, prompt: 'Check later' }, options);

    expect(scope.sleeping).toBe(true);
  }));
});

it('does not count detached subagent runs as foreground work', async () => {
  const scope = { ...owner(), jobs: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), list: vi.fn() }, sleeping: false };

  await backgroundContext.run(scope, async () => {
    noteForegroundSubagents(detachedCallId('turn', 'fan'));

    expect(subagentsThisStep()).toBe(false);
  });
});

it('keeps detached subagent reports structured, as in the foreground, instead of spilling them', async () => {
  const reports = { results: [{ agent_id: 'a1', report: 'x'.repeat(50_000) }] };
  const execute = vi.fn(async () => reports);
  const present = vi.fn(async () => 'spilled preview');
  let output: unknown;
  const jobs = { start: vi.fn(async (_owner, _input, run) => {
    output = await run(new AbortController().signal);
    return { ...owner(), id: 'job', tool: 'run_subagents', status: 'running' as const, createdAt: 1 };
  }), get: vi.fn(), cancel: vi.fn(), list: vi.fn() };
  const tools = backgroundTools({ run_subagents: tool({ inputSchema: jsonSchema({ type: 'object' }), execute }) }, present);

  await backgroundContext.run({ ...owner(), jobs, sleeping: false }, () =>
    (tools.start_background_tool.execute as any)({ tool: 'run_subagents', args: { tasks: [] } }, options));

  expect(output).toBe(reports);
  expect(present).not.toHaveBeenCalled();
});

it('never spills a subagent job read with background_tool_status, but still spills other large jobs', async () => {
  const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'codeberg-status-spill-')));
  const job = (tool: string) => ({ ...owner(), id: 'job', tool, fingerprint: 'f', createdAt: 1, status: 'completed' as const,
    args: { tasks: [{ description: 'Check', prompt: 'p'.repeat(16_000), agent_type: 'worker' }] },
    output: { results: [{ agent_id: 'a1', report: 'x'.repeat(50_000) }] } });
  let current = job('run_subagents');
  const jobs = { start: vi.fn(), get: vi.fn(async () => current), cancel: vi.fn(), list: vi.fn() };
  const tools = wrapToolOutputs(backgroundTools({}), store);
  const status = () => backgroundContext.run({ ...owner(), jobs, sleeping: false }, () =>
    (tools.background_tool_status.execute as any)({ job_id: 'job' }, options));

  const read = await status() as Record<string, unknown>;

  // Only what the agent and the chat card use: no full briefs, fingerprint, or raw progress.
  expect(read).toEqual({ id: 'job', chatId: 'chat', tool: 'run_subagents', status: 'completed', createdAt: 1,
    tasks: [{ description: 'Check', agent_type: 'worker' }], results: [{ agent_id: 'a1', report: 'x'.repeat(50_000) }] });

  current = job('grep');

  expect(typeof await status()).toBe('string');
});

it('keeps a wake-up it could not withdraw for the turn to cancel, and still refuses to sleep', async () => {
  const tools = backgroundTools({});
  const scope: Record<string, unknown> = { ...owner(), jobs: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), list: vi.fn() }, sleeping: false };
  const scheduler = { create: vi.fn(async () => ({ id: 'wake' })), list: vi.fn(), cancel: vi.fn(async () => { throw new Error('disk full'); }) };

  await scheduleContext.run({ ...owner(), scheduler }, () => backgroundContext.run(scope as never, async () => {
    noteForegroundSubagents('fan');

    await expect((tools.sleep_agent.execute as any)({ delay_seconds: 60, prompt: 'Check later' }, options))
      .rejects.toThrow('start_background_tool');
  }));

  expect(scope.sleeping).toBe(false);
  expect(scope.withdrawWakeIds).toEqual(['wake']);
});

it('withdraws a saved sleep at the end of a step that also called run_subagents, and notes it for the next step', async () => {
  const scheduler = { create: vi.fn(), list: vi.fn(), cancel: vi.fn(async () => ({})) };
  const scope: Record<string, unknown> = { ...owner(), jobs: {}, sleeping: true, sleepWakeId: 'wake', sleepRequest: Promise.resolve() };
  const step = (...names: string[]) => ({ steps: [{ toolCalls: names.map((toolName) => ({ toolName })) }] });

  await scheduleContext.run({ ...owner(), scheduler }, () => backgroundContext.run(scope as never, async () => {
    expect(await sleepEndsTurn(step('sleep_agent', 'run_subagents'))).toBe(false);

    expect(scope.sleeping).toBe(false);
    expect(scheduler.cancel).toHaveBeenCalledExactlyOnceWith('chat', 'wake');
    expect(JSON.stringify(withSleepNote([]))).toContain('sleep_agent was withdrawn');
    expect(withSleepNote([])).toEqual([]);

    scope.sleeping = true;
    expect(await sleepEndsTurn(step('sleep_agent', 'start_background_tool'))).toBe(true);
  }));
});

it('keeps background jobs from different subagents apart even when their tool call ids repeat', async () => {
  const starts: string[] = [];
  const jobs = { start: vi.fn(async (_owner, input) => {
    starts.push(input.callId);
    return { ...owner(), id: input.callId, tool: 'example', status: 'running' as const, createdAt: 1 };
  }), get: vi.fn(), cancel: vi.fn(), list: vi.fn() };
  const tools = backgroundTools({ example: tool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => 'ok' }) });
  const start = () => (tools.start_background_tool.execute as any)({ tool: 'example', args: {} }, { ...options, toolCallId: 'call_0' });

  await backgroundContext.run({ ...owner(), jobs, sleeping: false }, async () => {
    await callerScope.run('sa_1', start);
    await callerScope.run('sa_2', start);
    await start();
  });

  expect(starts).toEqual(['sa_1:call_0', 'sa_2:call_0', 'call_0']);
});
