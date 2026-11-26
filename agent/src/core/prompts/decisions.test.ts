import { expect, it } from 'vitest';
import { agentSystemPrompt, AGENT_SYSTEM } from '../prompt.js';

it('adds the decisions strategy when the decisions tool is available', () => {
  const prompt = agentSystemPrompt({ enabled: false, search: false, decisions: true });

  expect(prompt).toContain('Decisions strategy:');
});

it('keeps disabled prompts unchanged and never advertises an unavailable decisions tool', () => {
  const options = { enabled: false, search: false };

  expect(agentSystemPrompt(options)).toBe(AGENT_SYSTEM);
  expect(agentSystemPrompt({ ...options, decisions: false })).toBe(AGENT_SYSTEM);
});

