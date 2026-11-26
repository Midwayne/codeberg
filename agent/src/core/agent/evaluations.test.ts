import type { LanguageModel } from 'ai';
import { expect, it } from 'vitest';

import { DaemonClient } from '../client.js';
import { agentEvaluationRuntime } from './evaluations.js';

const named = (provider: string, modelId: string) => ({ provider, modelId }) as unknown as LanguageModel;
const daemon = new DaemonClient('http://127.0.0.1:1');

it('judges terminal evaluations with the chat model, not the cheaper subagent model', async () => {
  const runtime = agentEvaluationRuntime({ model: named('openai', 'chat'), subagentModel: named('openai', 'cheap'), daemon });

  expect((await runtime.configuration())?.judge?.model).toBe('openai:chat');
});

it('judges with CODEBERG_JUDGE_MODEL’s model when one is given', async () => {
  const runtime = agentEvaluationRuntime({ model: named('openai', 'chat'), judgeModel: named('anthropic', 'strong'), daemon });

  expect((await runtime.configuration())?.judge?.model).toBe('anthropic:strong');
});

it('runs terminal evaluations without a judge when it is off', async () => {
  const runtime = agentEvaluationRuntime({ model: named('openai', 'chat'), judgeModel: null, daemon });

  expect(await runtime.configuration()).not.toHaveProperty('judge');
});
