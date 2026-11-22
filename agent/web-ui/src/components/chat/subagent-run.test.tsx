import type { UIMessage } from 'ai';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { Message } from './message';
import { SubagentRun } from './subagent-run';

const input = { tasks: [
  { description: 'Check checkout', prompt: 'Look at checkout errors' },
  { description: 'Check billing', prompt: 'Look at billing errors', agent_type: 'worker' },
] };

it('shows each running subagent with its live activity and an overall count', () => {
  const html = renderToStaticMarkup(<SubagentRun name="run_subagents" part={{
    type: 'tool-run_subagents', state: 'output-available', input, preliminary: true,
    output: { results: [
      { agent_id: 'sa_1', description: 'Check checkout', agent_type: 'explorer', status: 'running', tool_calls: 2, steps: 3, activity: 'grep · timeout', elapsed_ms: 4000 },
      { agent_id: 'sa_2', description: 'Check billing', agent_type: 'worker', status: 'queued', tool_calls: 0 },
    ] },
  } as never} />);

  expect(html).toContain('Running 2 subagents');
  expect(html).toContain('0 of 2 done');
  expect(html).toContain('grep · timeout');
  expect(html).toContain('step 3 · 2 tools · 4s');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('worker');
});

it('shows finished reports, with a single report open by default', () => {
  const html = renderToStaticMarkup(<SubagentRun name="message_subagent" part={{
    type: 'tool-message_subagent', state: 'output-available', input: { agent_id: 'sa_1', message: 'What about p50?' },
    output: { results: [{ agent_id: 'sa_1', description: 'Check checkout', agent_type: 'explorer', status: 'completed',
      tool_calls: 1, report: 'p50 is **120ms**', usage: { input_tokens: 900, output_tokens: 100 }, transcript: '/ctx/subagents/sa_1.json' }] },
  } as never} />);

  expect(html).toContain('Subagent follow-up');
  expect(html).toMatch(/<details[^>]*open/);
  expect(html).toContain('120ms');
  expect(html).toContain('What about p50?');
  expect(html).toContain('1,000 tokens');
  expect(html).toContain('/ctx/subagents/sa_1.json');
});

it('keeps subagent runs out of the collapsed tool-call group', () => {
  const message: UIMessage = { id: 'a1', role: 'assistant', parts: [
    { type: 'tool-grep', toolCallId: 'g', state: 'output-available', input: {}, output: [] },
    { type: 'tool-run_subagents', toolCallId: 's', state: 'input-available', input },
  ] as never };

  const html = renderToStaticMarkup(<Message message={message} />);

  expect(html).toContain('1 tool call');
  expect(html).toContain('Starting 2 subagents');
});

it('shows a status check of background subagents as one folded line, not a second card', () => {
  const results = [
    { agent_id: 'sa_1', description: 'Check checkout', agent_type: 'explorer', status: 'completed', tool_calls: 2, report: 'checkout is fine' },
    { agent_id: 'sa_2', description: 'Check billing', agent_type: 'worker', status: 'completed', tool_calls: 1, report: 'billing is fine' },
  ];
  const message: UIMessage = { id: 'a2', role: 'assistant', parts: [
    { type: 'tool-background_tool_status', toolCallId: 'b', state: 'output-available', input: { job_id: 'job' },
      output: { id: 'job', tool: 'run_subagents', status: 'completed', tasks: input.tasks, results } },
  ] as never };

  const html = renderToStaticMarkup(<Message message={message} />);

  expect(html).toContain('1 tool call');
  expect(html).toContain('Read reports from 2 background subagents');
  expect(html).not.toContain('checkout is fine');
  expect(html).not.toContain('2 subagents finished');
});

it('folds a follow-up the agent sent to an unknown subagent with the other tool calls', () => {
  const message: UIMessage = { id: 'a3', role: 'assistant', parts: [
    { type: 'tool-message_subagent', toolCallId: 'm', state: 'output-error', input: { agent_id: 'sa_gone', message: 'More?' },
      errorText: 'Unknown subagent sa_gone in this chat.' },
  ] as never };

  const html = renderToStaticMarkup(<Message message={message} />);

  expect(html).toContain('1 tool call');
  expect(html).not.toContain('Subagent follow-up');
});
