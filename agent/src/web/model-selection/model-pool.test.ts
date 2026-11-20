import type { ToolLoopAgent } from 'ai';
import { expect, it, vi } from 'vitest';

import type { ResolvedModelSelection } from '../chat-routes.js';
import { MAX_IDLE_AGENTS, ModelAgentPool } from './model-pool.js';

const selection = (enabled: number): ResolvedModelSelection => ({
  key: 'openai:test', model: 'openai:test', effort: 'low', contextWindow: 50_000,
  subagents: { enabled: enabled % 2 === 0, model: { key: `k${enabled}`, model: 'openai:small', effort: 'low', contextWindow: 1 } },
});

function pool() {
  const closed: ToolLoopAgent[] = [];
  const models = new ModelAgentPool({
    build: async () => ({}) as ToolLoopAgent,
    closeLoop: vi.fn(async (loop: ToolLoopAgent) => void closed.push(loop)),
  });

  return { models, closed };
}

it('closes idle agents once more than a few selections have been used', async () => {
  const { models, closed } = pool();
  const loops: ToolLoopAgent[] = [];

  for (let index = 0; index <= MAX_IDLE_AGENTS; index++) {
    const release = models.retain(selection(index));
    loops.push(await models.forSelection(selection(index)));
    await release();
  }

  expect(closed).toEqual([loops[0]]);
  expect(await models.forSelection(selection(MAX_IDLE_AGENTS))).toBe(loops[MAX_IDLE_AGENTS]);
});

it('never closes an agent a turn is still using', async () => {
  const { models, closed } = pool();
  const busy = models.retain(selection(0));
  await models.forSelection(selection(0));

  for (let index = 1; index <= MAX_IDLE_AGENTS + 1; index++) {
    const release = models.retain(selection(index));
    await models.forSelection(selection(index));
    await release();
  }

  expect(closed).toHaveLength(1);
  await busy();
  expect(closed).toHaveLength(2);
});
