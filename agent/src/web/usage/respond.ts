import { pipeAgentUIStreamToResponse } from 'ai';
import type { ChatResponder } from '../chat-routes.js';
import type { WebServerOptions } from '../server/types.js';
import { captureUsage } from './model.js';
import type { UsageStore } from './store.js';

export function defaultChatResponder(opts: WebServerOptions, store: UsageStore): ChatResponder {
  return async (res, messages, selection) => {
    const agent = selection && opts.selectAgent ? await opts.selectAgent(selection) : opts.agent;
    if (!agent) throw new Error('Select an available chat model.');

    const rates = selection
      ? (await opts.modelSettings?.current())?.models.find((entry) => entry.key === selection.key)?.pricing
      : undefined;

    await pipeAgentUIStreamToResponse({ response: res, agent, uiMessages: messages,
      onStepEnd: async (step) => {
        const model = selection?.model ?? `${step.model.provider}:${step.model.modelId}`;
        await captureUsage(store, { model, key: selection?.key ?? model, kind: 'chat' }, {
          inputTokens: { total: step.usage.inputTokens, noCache: step.usage.inputTokenDetails.noCacheTokens,
            cacheRead: step.usage.inputTokenDetails.cacheReadTokens, cacheWrite: step.usage.inputTokenDetails.cacheWriteTokens },
          outputTokens: { total: step.usage.outputTokens, text: step.usage.outputTokenDetails.textTokens,
            reasoning: step.usage.outputTokenDetails.reasoningTokens },
        }, rates);
      },
    });
  };
}
