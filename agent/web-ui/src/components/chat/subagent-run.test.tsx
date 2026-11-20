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
