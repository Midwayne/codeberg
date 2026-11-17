import type { UIMessage } from 'ai';
import { codebergDataHome } from '../../core/paths.js';
import type { MessageSearchHit } from '../../core/session-search.js';

/** One persisted browser chat — UI messages verbatim, so a resume re-renders
 *  with full fidelity (tool cards, reasoning, citations). */
export interface WebSessionRecord {
  id: string;
  /** Derived from the first user message until the user renames it; shown in the sidebar. */
  title: string;
  /** Set by a rename so later message saves keep the chosen title. */
  titleEdited?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  /** Session this one was branched from, when created via Branch. */
  parentId?: string;
  /** Latest server-owned search run; browser snapshots cannot replace its messages. */
  serverRunId?: string;
  pinned?: boolean;
  archived?: boolean;
}

/** Lightweight row for the sidebar list (no message bodies sent). */
export interface WebSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
  pinned: boolean;
  archived: boolean;
}

export type WebSessionSearchResult = WebSessionSummary & {
  role: MessageSearchHit['role'] | 'title';
  messageId?: string;
  snippet: string;
};

export { isValidSessionId } from '../../core/session-id.js';

const MAX_SESSION_TITLE_LENGTH = 200;

/** A user-chosen title on one line, or undefined when it is empty or too long. */
export function normalizeSessionTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const title = value.replace(/\s+/g, ' ').trim();

  return title && title.length <= MAX_SESSION_TITLE_LENGTH ? title : undefined;
}

export function home(env: NodeJS.ProcessEnv = process.env): string {
  return codebergDataHome(env);
}

export function countTurns(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}
