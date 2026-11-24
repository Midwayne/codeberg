import { chatScope } from '../chat-scope.js';
import { evictOldest, touch } from '../lru.js';
import { Semaphore } from '../semaphore.js';
import { SubagentStore } from './store.js';

/** Chats whose subagent sessions stay in memory; the least recently used idle ones are dropped. */
const MAX_SUBAGENT_CHATS = 32;

/** One chat's subagents: its follow-up sessions and a gate that shows while any run. */
export interface SubagentChatScope {
  store: SubagentStore;
  gate: Semaphore;
}

/**
 * Pooled agents serve every chat with the same model selection, so sessions
 * are kept per chat: agent ids from one chat do not resolve in another. The
 * main agent decides how many subagents to start, so the gate has no limit;
 * it only marks chats with subagents running so they are never evicted.
 * Terminal runs have no chat and share a single scope.
 */
export class SubagentScopes {
  private readonly scopes = new Map<string, SubagentChatScope>();

  constructor(private readonly capacity = MAX_SUBAGENT_CHATS) {}

  current(): SubagentChatScope {
    const key = chatScope.getStore() ?? '';
    const scope = touch(this.scopes, key, this.scopes.get(key) ?? { store: new SubagentStore(), gate: new Semaphore(Number.POSITIVE_INFINITY) });

    // Idle chats go first; the requesting chat and chats with subagents running or queued stay.
    evictOldest(this.scopes, this.capacity, (other, otherKey) => otherKey !== key && !other.gate.busy);

    return scope;
  }
}
