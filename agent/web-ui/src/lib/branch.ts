import type { UIMessage } from 'ai';

import { branchTitle, branchTranscript } from '@agent/core/branch.js';

import { markerId } from './message-rail';
import { deriveTitle, newSessionId } from './sessions';

/** The chat the workspace is showing. One value: id, lineage, and transcript. */
export interface OpenSession {
  id: string;
  /** Set when resumed or branched so later saves do not re-derive the title. */
  title?: string;
  parentId?: string;
  messages: UIMessage[];
}

export function blankSession(id: string = newSessionId()): OpenSession {
  return { id, messages: [] };
}

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
