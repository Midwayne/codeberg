import { expect, it } from 'vitest';

import { agentProfiles } from './model-profiles.js';

it('keeps separate local chat and summary windows and respects request-bound settings', () => {
  const result = agentProfiles('ollama:chat', 'ollama:summary', {
    CODEBERG_CONTEXT_WINDOW: '131072',
    CODEBERG_CONTEXT_BUDGET: '64000',
    CODEBERG_SUMMARY_CONTEXT_WINDOW: '4096',
  });

  expect(result.profile.contextWindow).toBe(131072);
  expect(result.profile.workingWindow).toBe(64000);
  expect(result.summaryProfile.contextWindow).toBe(4096);
});

it('infers the separate summary window or shares a catalog window for the same model', () => {
  expect(agentProfiles('openai:chat', 'ollama:summary', {}).summaryProfile.contextWindow).toBe(8192);
  expect(agentProfiles('ollama:chat', 'ollama:chat', {}, 16384).summaryProfile.contextWindow).toBe(16384);
});
