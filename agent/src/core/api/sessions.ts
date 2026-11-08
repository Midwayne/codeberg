import type { UIMessage } from 'ai';
import type { MessageSearchHit } from '../session-search.js';

/**
 * Chat and run ids double as filenames and arrive from the client, so they are
 * constrained to a safe charset; a `../` id can never reach `join`.
 */
export const SESSION_ID_SOURCE = '[A-Za-z0-9_-]{1,64}';

export const SESSION_ID_PATTERN = new RegExp(`^${SESSION_ID_SOURCE}$`);

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

/**
 * One persisted browser chat: UI messages verbatim, so a resume re-renders
 * with full fidelity (tool cards, reasoning, citations). The web UI binds
 * `Message` to its own `ai` package, which is a separate install.
 */
export interface SessionRecord<Message = UIMessage> {
  id: string;
  /** Derived from the first user message; shown in the sidebar. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Session this one was branched from, when created via Branch. */
  parentId?: string;
  /** Latest server-owned search run; browser snapshots cannot replace its messages. */
  serverRunId?: string;
  pinned?: boolean;
  archived?: boolean;
}

/** Lightweight row for the sidebar list (no message bodies sent). */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
  pinned: boolean;
  archived: boolean;
}

export type SessionSearchResult = SessionSummary & {
  role: MessageSearchHit['role'] | 'title';
  messageId?: string;
  snippet: string;
};

export type SessionFlags = Partial<Pick<SessionRecord, 'pinned' | 'archived'>>;
