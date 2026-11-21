import { expect, it } from 'vitest';

import { AGENT_SYSTEM, agentSystemPrompt } from '../prompt.js';

it('uses concise small-window instructions while retaining query consent and tool efficiency rules', () => {
  const prompt = agentSystemPrompt({
    enabled: false,
    search: false,
    compact: true,
    mcp: [{ name: 'databases', state: 'connected', tools: [{ name: 'query', callable: 'mcp_databases_query' }] }],
  });

  expect(agentSystemPrompt({ enabled: false, search: false, compact: true }).length).toBeLessThan(AGENT_SYSTEM.length / 2);
  expect(prompt).toContain('Put every independent tool call in the same response');
  expect(prompt).toContain('execute only after agreement');
  expect(prompt).toContain('explicit user-supplied path');
  expect(prompt).toContain('NOT_READY');
});
