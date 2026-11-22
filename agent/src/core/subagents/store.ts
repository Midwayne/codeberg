import { randomBytes } from 'node:crypto';
import type { ModelMessage } from 'ai';

import { evictOldest, touch } from '../lru.js';
import type { SubagentType } from './roles.js';

/** Subagents kept in memory for follow-ups; the least recently used are dropped first. */
const MAX_SUBAGENT_SESSIONS = 16;

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
    evictOldest(this.sessions, this.capacity);

    return session;
  }

  /** Keep a session rebuilt from its transcript, unless one with its id is already here. */
  adopt(session: SubagentSession): SubagentSession {
    const existing = this.sessions.get(session.id);
    if (existing) return touch(this.sessions, session.id, existing);

    this.sessions.set(session.id, session);
    evictOldest(this.sessions, this.capacity);

    return session;
  }

  get(id: string): SubagentSession | undefined {
    const session = this.sessions.get(id);

    // A follow-up marks the session as recently used.
    return session && touch(this.sessions, id, session);
  }
}
