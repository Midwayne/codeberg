import { expect, it } from 'vitest';
import { agentSystemPrompt, AGENT_SYSTEM } from '../prompt.js';

it.each([false, true])('guides proactive bounded decisions when available (compact=%s)', (compact) => {
  const prompt = agentSystemPrompt({ enabled: false, search: false, decisions: true, compact });

  expect(prompt).toContain('Decisions strategy:');
  expect(prompt).toContain('The Decisions API is substantially cheaper for bounded judgments than using the main chat model.');
  expect(prompt).not.toContain('account for provider pricing');
  expect(prompt).toContain('before reading several candidate files');
  expect(prompt).toContain('Batch independent questions');
  expect(prompt).toContain('simple or deterministic');
  expect(prompt).toContain('verify important conclusions');
});

it('keeps disabled prompts unchanged and never advertises an unavailable decisions tool', () => {
  const options = { enabled: false, search: false };

  expect(agentSystemPrompt(options)).toBe(AGENT_SYSTEM);
  expect(agentSystemPrompt({ ...options, decisions: false })).toBe(AGENT_SYSTEM);
  expect(agentSystemPrompt({ ...options, compact: true })).not.toContain('Decisions strategy:');
});

