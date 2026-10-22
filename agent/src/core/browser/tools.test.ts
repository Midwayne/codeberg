import { expect, it, vi } from 'vitest';
import { browserToolSource } from './tools.js';
import { isBatchable } from '../tools/batch.js';

it('does not register or launch browser use when disabled', async () => {
  const run = vi.fn();
  expect(await browserToolSource({}, '', run).tools()).toEqual({});
  expect(run).not.toHaveBeenCalled();
});

it('delegates a task and cancellation signal to a separate browser runner only on execution', async () => {
  const run = vi.fn(async () => ({ status: 'completed' as const, result: 'Page title' }));
  const tools = await browserToolSource({ CODEBERG_BROWSER_USE: 'true' }, 'openai:chat', run).tools();
  expect(run).not.toHaveBeenCalled();
  const controller = new AbortController();
  const execute = tools.browser_task.execute as Function;

  expect(await execute({ task: 'Read the title' }, { abortSignal: controller.signal })).toMatchObject({ status: 'completed' });
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ model: 'chat' }), 'Read the title', controller.signal, {});
  expect(isBatchable('browser_task')).toBe(false);
});

it('keeps code chat usable with an unsupported browser model and reports it only on delegation', async () => {
  const run = vi.fn();
  const tools = await browserToolSource({ CODEBERG_BROWSER_USE: 'true' }, 'custom:chat', run).tools();

  expect(tools.browser_task).toBeDefined();
  expect(() => (tools.browser_task.execute as Function)({ task: 'Read a page' }, {})).toThrow('Unsupported');
  expect(run).not.toHaveBeenCalled();
});

it('passes explicit retention and reuse options and registers session discovery and close tools', async () => {
  const run = vi.fn(async () => ({ status: 'completed' as const, result: 'Page title', session_id: 'existing', kept_open: true }));
  const tools = await browserToolSource({ CODEBERG_BROWSER_USE: 'true' }, 'openai:chat', run).tools();

  await (tools.browser_task.execute as Function)({ task: 'Inspect', session_id: 'existing', keep_open: true }, {});

  expect(run).toHaveBeenCalledWith(expect.anything(), 'Inspect', undefined, { session_id: 'existing', keep_open: true });
  expect(tools.browser_sessions).toBeDefined();
  expect(tools.browser_close).toBeDefined();
  expect(isBatchable('browser_close')).toBe(false);
  expect(isBatchable('browser_sessions')).toBe(false);
});
