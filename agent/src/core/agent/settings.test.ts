import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { profileFor } from '../../providers/profiles.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { evaluationConfiguration } from './evaluations.js';
import { resolveAgentSettings } from './settings.js';

function mockModel(provider: string, modelId: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider,
    modelId,
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Summary' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

const daemon = new DaemonClient(DEFAULT_DAEMON_URL);

describe('resolveAgentSettings', () => {
  it('summarizes on the chat model with the configured effort', async () => {
    const model = mockModel('openai.responses', 'gpt-5');
    const settings = resolveAgentSettings({ model, daemon, reasoning: 'high', learning: false, env: {} });

    await settings.generator.generate({ system: 'Summarize', prompt: 'History' });

    expect(model.doGenerateCalls[0]?.reasoning).toBe('high');
  });

  it('runs a different background model at its provider default', async () => {
    const model = mockModel('openai.responses', 'gpt-5');
    const subagentModel = mockModel('anthropic.messages', 'claude-haiku-4-5');
    const settings = resolveAgentSettings({ model, subagentModel, daemon, reasoning: 'max', learning: false, env: {} });

    await settings.generator.generate({ system: 'Summarize', prompt: 'History' });

    expect(subagentModel.doGenerateCalls[0]?.reasoning).toBeUndefined();
    expect(subagentModel.doGenerateCalls[0]?.providerOptions).toBeUndefined();
  });

  it('sizes a separate summarizer from CODEBERG_SUMMARY_CONTEXT_WINDOW', () => {
    const settings = resolveAgentSettings({
      model: mockModel('openai.responses', 'gpt-5'),
      subagentModel: mockModel('anthropic.messages', 'claude-haiku-4-5'),
      daemon,
      learning: false,
      env: { CODEBERG_SUMMARY_CONTEXT_WINDOW: '50000' },
    });

    expect(settings.summaryProfile).toMatchObject({ provider: 'anthropic', modelId: 'claude-haiku-4-5', contextWindow: 50_000 });
  });
});

describe('evaluationConfiguration', () => {
  it('names models by provider:model spec, not the ai-sdk provider id', () => {
    const configuration = evaluationConfiguration({
      model: mockModel('openai.responses', 'gpt-5'),
      judge: mockModel('anthropic.messages', 'claude-haiku-4-5'),
      reasoning: 'max',
      profile: profileFor('openai:gpt-5', {}),
      judgeProfile: profileFor('anthropic:claude-haiku-4-5', {}),
      daemon,
    });

    expect(configuration.candidate).toMatchObject({ model: 'openai:gpt-5', effort: 'max', contextWindow: 1_000_000 });
    expect(configuration.judge).toMatchObject({ model: 'anthropic:claude-haiku-4-5', effort: 'provider-default', contextWindow: 200_000 });
  });
});
