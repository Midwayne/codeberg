import { createAgentUIStream } from 'ai';

import type { ChatGenerator } from '../runs/types.js';
import type { WebServerOptions } from '../server/types.js';
import { trackedChatAgent } from './chat-usage.js';
import type { UsageStore } from './store.js';

export function defaultChatGenerator(opts: WebServerOptions, store: UsageStore): ChatGenerator {
  return async ({ messages, selection, signal }) => {
    const { agent, onStepEnd } = await trackedChatAgent(opts, store, selection);
    const stream = await createAgentUIStream({ agent, uiMessages: messages, abortSignal: signal, onStepEnd });

    return { stream };
  };
}
