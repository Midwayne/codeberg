import type { createAgentUIStream } from 'ai';

import type { ResolvedModelSelection } from '../chat-routes.js';
import type { WebServerOptions } from '../server/types.js';
import { captureUsage } from './model.js';
import type { UsageStore } from './store.js';

type StepEnd = NonNullable<Parameters<typeof createAgentUIStream>[0]['onStepEnd']>;

/**
 * The agent for one chat turn, plus a step callback that records the turn's
 * token usage under the selected model (or the step's own model when the
 * request carries no selection).
 */
export async function trackedChatAgent(
  opts: WebServerOptions,
  store: UsageStore,
  selection: ResolvedModelSelection | undefined,
) {
  const agent = selection && opts.selectAgent ? await opts.selectAgent(selection) : opts.agent;
  if (!agent) throw new Error('Select an available chat model.');

  const rates = selection
    ? (await opts.modelSettings?.current())?.models.find((entry) => entry.key === selection.key)?.pricing
    : undefined;

  const onStepEnd: StepEnd = async (step) => {
    const model = selection?.model ?? `${step.model.provider}:${step.model.modelId}`;
    const { usage } = step;

    const tokens = {
      inputTokens: {
        total: usage.inputTokens,
        noCache: usage.inputTokenDetails.noCacheTokens,
        cacheRead: usage.inputTokenDetails.cacheReadTokens,
        cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
      },
      outputTokens: {
        total: usage.outputTokens,
        text: usage.outputTokenDetails.textTokens,
        reasoning: usage.outputTokenDetails.reasoningTokens,
      },
    };

    await captureUsage(store, { model, key: selection?.key ?? model, kind: 'chat' }, tokens, rates);
  };

  return { agent, onStepEnd };
}
