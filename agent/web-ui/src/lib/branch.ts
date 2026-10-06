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

export function messageIndexById(messages: readonly { id?: string; role: string }[], id: string): number {
  return messages.findIndex((m, i) => markerId(m, i) === id);
}

/**
 * Fork `messages` through `throughIndex` into a new session record. Ids are
 * remapped so the live `useChat` store cannot alias the parent transcript.
 */
export type ChatBranchOptions = UIMessage[];

export function createChatBranch(
  messages: ChatBranchOptions,
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
