import { pipeAgentUIStreamToResponse } from 'ai';

import { chatAbortSignal } from '../chat-abort.js';
import type { ChatResponder } from '../chat-routes.js';
import type { WebServerOptions } from '../server/types.js';
import { trackedChatAgent } from './chat-usage.js';
import type { UsageStore } from './store.js';

export function defaultChatResponder(opts: WebServerOptions, store: UsageStore): ChatResponder {
  return async (res, messages, selection) => {
    const abortSignal = chatAbortSignal(res);
    const { agent, onStepEnd } = await trackedChatAgent(opts, store, selection);

    await pipeAgentUIStreamToResponse({ response: res, agent, uiMessages: messages, abortSignal, onStepEnd });
  };
}
