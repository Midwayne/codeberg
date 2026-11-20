import { describe, expect, it } from 'vitest';

import { isSubagentTool, subagentView } from './subagents';

const part = (over: Record<string, unknown>) => ({ type: 'tool-run_subagents', toolCallId: 'c1', ...over });

describe('subagentView', () => {
  it('shows every brief as queued before any output arrives', () => {
    const view = subagentView('run_subagents', part({
      state: 'input-available',
      input: { tasks: [{ description: 'Check checkout', prompt: 'Look at checkout' }, { description: 'Check billing', prompt: 'b', agent_type: 'worker' }] },
    }));

    expect(view.running).toBe(true);
    expect(view.title).toBe('Starting 2 subagents');
    expect(view.rows.map((row) => [row.description, row.agentType, row.status, row.brief])).toEqual([
      ['Check checkout', 'explorer', 'queued', 'Look at checkout'],
      ['Check billing', 'worker', 'queued', 'b'],
    ]);
  });

  it('merges live progress with the briefs and counts what is done', () => {
    const view = subagentView('run_subagents', part({
      state: 'output-available',
      preliminary: true,
      input: { tasks: [{ description: 'Check checkout', prompt: 'p1' }, { description: 'Check billing', prompt: 'p2' }] },
      output: { results: [
        { agent_id: 'sa_1', description: 'Check checkout', agent_type: 'explorer', status: 'running', tool_calls: 2, steps: 3, activity: 'grep · timeout', elapsed_ms: 4000 },
        { agent_id: 'sa_2', description: 'Check billing', agent_type: 'explorer', status: 'completed', tool_calls: 1, report: 'fine', elapsed_ms: 2000 },
      ] },
    }));

    expect(view.running).toBe(true);
    expect(view.title).toBe('Running 2 subagents');
    expect(view.summary).toBe('1 of 2 done');
    expect(view.rows[0]).toMatchObject({ status: 'running', activity: 'grep · timeout', brief: 'p1', toolCalls: 2, steps: 3 });
    // Same key as before progress arrived, so the row is not remounted.
    expect(view.rows.map((row) => row.key)).toEqual(['task-0', 'task-1']);
  });

  it('summarizes finished runs, including incomplete and failed ones', () => {
    const view = subagentView('run_subagents', part({
      state: 'output-available',
      output: { results: [
        { agent_id: 'sa_1', description: 'a', agent_type: 'explorer', status: 'completed', tool_calls: 2, usage: { input_tokens: 1000, output_tokens: 200 } },
        { agent_id: 'sa_2', description: 'b', agent_type: 'explorer', status: 'incomplete', tool_calls: 15 },
        { agent_id: 'sa_3', description: 'c', agent_type: 'worker', status: 'failed', tool_calls: 0, error: 'rate limited' },
      ] },
    }));

    expect(view.running).toBe(false);
    expect(view.title).toBe('3 subagents finished');
    expect(view.summary).toBe('1 done · 1 incomplete · 1 failed · 17 tool calls');
  });

  it('labels a follow-up message and treats a stopped call as failed', () => {
    const followUp = subagentView('message_subagent', { type: 'tool-message_subagent', state: 'input-available', input: { agent_id: 'sa_1', message: 'What about p50?' } });
    const stopped = subagentView('run_subagents', part({ state: 'output-error', errorText: 'aborted', input: { tasks: [{ description: 'a', prompt: 'p' }] } }));

    expect(followUp.title).toBe('Asking a subagent a follow-up');
    expect(followUp.rows[0]).toMatchObject({ brief: 'What about p50?', status: 'queued' });
    expect(stopped.running).toBe(false);
    expect(stopped.rows[0]).toMatchObject({ status: 'failed', error: 'aborted' });
  });
});

describe('isSubagentTool', () => {
  it('matches both subagent tools only', () => {
    expect(isSubagentTool('run_subagents')).toBe(true);
    expect(isSubagentTool('message_subagent')).toBe(true);
    expect(isSubagentTool('grep')).toBe(false);
  });
});
