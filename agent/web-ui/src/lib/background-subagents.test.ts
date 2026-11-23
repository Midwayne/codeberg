import { describe, expect, it } from 'vitest';

import { detachedSubagents, loadSubagentProgress, progressPart, settled, staysVisible, statusSubagents } from './background-subagents';

const tasks = [{ description: 'Check checkout', prompt: 'p1' }, { description: 'Check billing', prompt: 'p2' }];

describe('detachedSubagents', () => {
  it('finds a run_subagents call started with start_background_tool and its job id', () => {
    const part = { type: 'tool-start_background_tool', state: 'output-available',
      input: { tool: 'run_subagents', args: { tasks } }, output: { id: 'job-1', chatId: 'chat-1', tool: 'run_subagents', status: 'running' } };

    expect(detachedSubagents('start_background_tool', part)).toEqual({ name: 'run_subagents', jobId: 'job-1', chatId: 'chat-1', args: { tasks } });
  });

  it('ignores other detached tools, other tool names, and starts without a job yet', () => {
    const grep = { type: 'tool-start_background_tool', state: 'output-available', input: { tool: 'grep', args: {} }, output: { id: 'j', chatId: 'c' } };
    const pending = { type: 'tool-start_background_tool', state: 'input-available', input: { tool: 'run_subagents', args: { tasks } } };

    expect(detachedSubagents('start_background_tool', grep)).toBeUndefined();
    expect(detachedSubagents('start_background_tool', pending)).toBeUndefined();
    expect(detachedSubagents('grep', { ...grep, input: { tool: 'run_subagents' } })).toBeUndefined();
  });
});

describe('progressPart', () => {
  it('reads as running until the job settles, then as finished with its reports', () => {
    const results = [{ agent_id: 'a1', description: 'Check checkout', agent_type: 'explorer' as const, status: 'completed' as const, tool_calls: 1 }];

    expect(progressPart({ tasks }, undefined)).toMatchObject({ state: 'input-available', input: { tasks } });
    expect(progressPart({ tasks }, { status: 'running', results })).toMatchObject({ state: 'output-available', preliminary: true });
    expect(progressPart({ tasks }, { status: 'completed', results })).toMatchObject({ state: 'output-available', preliminary: false, output: { results } });
  });

  it('turns a failed, cancelled, or interrupted job into an error for its unfinished rows', () => {
    expect(progressPart({ tasks }, { status: 'cancelled', results: [] })).toMatchObject({ state: 'output-error', errorText: 'Cancelled' });
    expect(progressPart({ tasks }, { status: 'interrupted', error: 'Codeberg stopped.', results: [] }))
      .toMatchObject({ state: 'output-error', errorText: 'Codeberg stopped.' });
  });
});

describe('statusSubagents', () => {
  it('shows a background_tool_status result for a subagent job as that run', () => {
    const results = [{ agent_id: 'a1', status: 'completed', tool_calls: 1, report: 'fine' }];
    const part = { type: 'tool-background_tool_status', state: 'output-available',
      output: { id: 'job-1', tool: 'run_subagents', args: { tasks }, status: 'completed', output: { results } } };

    expect(statusSubagents('background_tool_status', part)).toEqual({ name: 'run_subagents',
      part: expect.objectContaining({ state: 'output-available', input: { tasks }, output: { status: 'completed', results } }) });
  });

  it('reads the trimmed status shape: task labels and top-level results', () => {
    const results = [{ agent_id: 'a1', status: 'completed', tool_calls: 1, report: 'fine' }];
    const part = { type: 'tool-background_tool_status', state: 'output-available',
      output: { id: 'job-1', tool: 'run_subagents', status: 'completed', tasks: [{ description: 'Check checkout' }], results } };

    expect(statusSubagents('background_tool_status', part)?.part).toMatchObject({
      input: { tasks: [{ description: 'Check checkout' }] }, output: { status: 'completed', results },
    });
  });

  it('leaves job lists and other jobs to the generic view', () => {
    const list = { type: 'tool-background_tool_status', state: 'output-available', output: [{ id: 'job-1', tool: 'run_subagents' }] };
    const grep = { type: 'tool-background_tool_status', state: 'output-available', output: { id: 'j', tool: 'grep', status: 'completed' } };

    expect(statusSubagents('background_tool_status', list)).toBeUndefined();
    expect(statusSubagents('background_tool_status', grep)).toBeUndefined();
  });
});

describe('staysVisible', () => {
  it('keeps subagent runs, detached ones, and sleeps out of the folded tool group', () => {
    const detached = { type: 'tool-start_background_tool', state: 'output-available', input: { tool: 'run_subagents', args: { tasks } }, output: { id: 'j', chatId: 'c' } };

    expect(staysVisible('run_subagents', { type: 'tool-run_subagents' })).toBe(true);
    expect(staysVisible('sleep_agent', { type: 'tool-sleep_agent', state: 'output-available' })).toBe(true);
    expect(staysVisible('start_background_tool', detached)).toBe(true);
  });

  it('folds a follow-up refused before any subagent ran', () => {
    const refused = { type: 'tool-message_subagent', state: 'output-error', errorText: 'Unknown subagent sa_x' };
    const stopped = { ...refused, output: { results: [{ agent_id: 'sa_x', status: 'failed' }] } };

    expect(staysVisible('message_subagent', refused)).toBe(false);
    expect(staysVisible('message_subagent', stopped)).toBe(true);
  });

  it('folds ordinary tools and refused sleeps', () => {
    expect(staysVisible('grep', { type: 'tool-grep', state: 'output-available' })).toBe(false);
    expect(staysVisible('sleep_agent', { type: 'tool-sleep_agent', state: 'output-error' })).toBe(false);
  });
});

describe('loadSubagentProgress', () => {
  it('reads a job that no longer exists as settled and unavailable, so the card stops polling', async () => {
    const api = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const progress = await loadSubagentProgress(api, 'chat', 'job');

    expect(progress).toEqual({ status: 'missing', results: [] });
    expect(settled(progress)).toBe(true);
    expect(progressPart({ tasks }, progress)).toMatchObject({ state: 'output-error', errorText: 'No longer available' });
  });

  it('still fails on other errors so the poll retries', async () => {
    const api = (async () => new Response('busy', { status: 503 })) as typeof fetch;

    await expect(loadSubagentProgress(api, 'chat', 'job')).rejects.toThrow();
  });
});
