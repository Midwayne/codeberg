import { spawnSync } from 'node:child_process';

import { jsonSchema, tool, type ToolSet } from 'ai';
import { expect, it, vi } from 'vitest';

import { backgroundContext, type BackgroundContext } from '../background/context.js';
import { backgroundTools } from '../background/tools.js';
import { scriptTool, SCRIPT_TOOL } from './tool.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

const owner = { chatId: 'chat', sourceRunId: 'turn' };

const options = { toolCallId: 'start', messages: [], abortSignal: new AbortController().signal };

it.skipIf(!hasPython)('runs a script as a background job the agent can cancel', async () => {
  const grep = tool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => ({ matches: [] }) });
  const local: ToolSet = { grep, ...scriptTool({ grep }, { python: 'python3' }) };

  // The job service owns the signal; cancel_background_tool aborts it.
  const controller = new AbortController();
  let settled: Promise<unknown> | undefined;

  const jobs = {
    start: vi.fn(async (_owner, _input, run: (signal: AbortSignal) => Promise<unknown>) => {
      settled = run(controller.signal).catch((error: unknown) => error);

      return { ...owner, id: 'job', tool: SCRIPT_TOOL, status: 'running' as const, createdAt: 1 };
    }),
    cancel: vi.fn(async () => controller.abort(new Error('cancelled by agent'))),
    get: vi.fn(),
    list: vi.fn(),
  } as unknown as BackgroundContext['jobs'];

  const tools = backgroundTools(local);
  const code = 'while True:\n    tools.grep(pattern="x")';

  await backgroundContext.run({ ...owner, jobs, sleeping: false }, async () => {
    const started = await (tools.start_background_tool.execute as any)({ tool: SCRIPT_TOOL, args: { code } }, options);
    expect(started).toMatchObject({ id: 'job', status: 'running' });

    await new Promise((resolve) => setTimeout(resolve, 300));
    await (tools.cancel_background_tool.execute as any)({ job_id: 'job' }, options);
  });

  const outcome = await settled;

  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('cancelled by agent');
});
