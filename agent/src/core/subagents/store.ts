import { randomBytes } from 'node:crypto';
import type { ModelMessage } from 'ai';

import { evictOldest, touch } from '../lru.js';
import type { SubagentType } from './roles.js';

/** Subagents one call may start, and how many may run at once in one chat. */
export const MAX_SUBAGENTS = 64;

/**
 * Subagents kept in memory for follow-ups; the least recently used idle ones
 * are dropped first, and a running one never is. Room for two full calls, so
 * parallel run_subagents calls in one step do not evict each other's sessions.
 */
const MAX_SUBAGENT_SESSIONS = 2 * MAX_SUBAGENTS;

/** One subagent's identity and conversation, kept so it can be messaged again. */
export interface SubagentSession {
  id: string;
  type: SubagentType;
  description: string;
  messages: ModelMessage[];
  busy: boolean;
}

/** In-memory sessions with unguessable ids, bounded to the `capacity` most recently used. */
export class SubagentStore {
  private readonly sessions = new Map<string, SubagentSession>();

  constructor(private readonly capacity = MAX_SUBAGENT_SESSIONS) {}

  create(type: SubagentType, description: string): SubagentSession {
    const session = { id: `sa_${randomBytes(8).toString('hex')}`, type, description, messages: [], busy: false };
    this.sessions.set(session.id, session);
    this.evictIdle();

    return session;
  }

  /** Keep a session rebuilt from its transcript, unless one with its id is already here. */
  adopt(session: SubagentSession): SubagentSession {
    const existing = this.sessions.get(session.id);
    if (existing) return touch(this.sessions, session.id, existing);

    this.sessions.set(session.id, session);
    this.evictIdle();

    return session;
  }

  /** A transcript can restore an evicted session; a running one cannot be dropped at all. */
  private evictIdle(): void {
    evictOldest(this.sessions, this.capacity, (session) => !session.busy);
  }

  get(id: string): SubagentSession | undefined {
    const session = this.sessions.get(id);

    // A follow-up marks the session as recently used.
    return session && touch(this.sessions, id, session);
  }
}
