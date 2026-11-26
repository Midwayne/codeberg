import type { UIMessage } from 'ai';
import { expect, it } from 'vitest';

import { extractTrajectory } from './trajectory.js';

it('takes the answer from the main agent’s text, never from subagent reports', () => {
  const message = {
    id: 'a',
    role: 'assistant',
    parts: [
      {
        type: 'tool-run_subagents',
        toolCallId: 'c1',
        state: 'output-available',
        input: { tasks: [{ description: 'Check the indexer' }] },
        output: { results: [{ report: 'SUBAGENT REPORT: the indexer is idle.' }] },
      },
      { type: 'text', text: 'The indexer is idle [core/src/index.c:10-20].' },
    ],
  } as unknown as UIMessage;

  const trajectory = extractTrajectory(message);

  expect(trajectory.answer).toBe('The indexer is idle [core/src/index.c:10-20].');
  expect(trajectory.toolsInvoked.map((tool) => tool.name)).toEqual(['run_subagents']);
});
