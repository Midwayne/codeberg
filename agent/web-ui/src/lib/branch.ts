import type { UIMessage } from 'ai';

import { branchTitle, branchTranscript } from '@agent/core/branch.js';

import { markerId } from './message-rail';
import { deriveTitle, newSessionId } from './sessions';

/** Payload the workspace persists and then adopts as the live chat. */
export interface ChatBranch {
  id: string;
  title: string;
  messages: UIMessage[];
  parentId: string;
}

/** Index of the message the rail/tick id refers to, or -1. */
export function messageIndexById(
  messages: readonly { id?: string; role: string }[],
  id: string,
): number {
  return messages.findIndex((m, i) => markerId(m, i) === id);
}

/**
 * Fork `messages` through `throughIndex` into a new session record. Ids are
 * remapped so the live `useChat` store cannot alias the parent transcript.
 */
export function createChatBranch(
  messages: UIMessage[],
  throughIndex: number,
  parentId: string,
  opts?: {
    newId?: () => string;
    newMessageId?: () => string;
  },
): ChatBranch {
  const newId = opts?.newId ?? newSessionId;
  const newMessageId = opts?.newMessageId ?? (() => crypto.randomUUID());
  const forked = branchTranscript(messages, {
    throughIndex,
    remap: (m) => ({ ...m, id: newMessageId() }),
  });
  return {
    id: newId(),
    title: branchTitle(deriveTitle(forked)),
    messages: forked,
    parentId,
  };
}

/** Snapshot of an adopt/resume/branch so auto-save can wait for React + useChat. */
export interface SessionAdopt {
  id: string;
  lastId: string;
}

/**
 * `useChat.setMessages` and React session-id state can flush on different
 * frames. Auto-save must not run until both sides show the adopted pair —
 * otherwise a new id can be persisted with the previous transcript (or the
 * parent id with the branch prefix).
 */
export function isSessionSettled(
  pending: SessionAdopt | null,
  sessionId: string,
  messages: readonly { id?: string }[],
): boolean {
  if (pending === null) {
    return true;
  }
  return pending.id === sessionId && (messages.at(-1)?.id ?? '') === pending.lastId;
}
