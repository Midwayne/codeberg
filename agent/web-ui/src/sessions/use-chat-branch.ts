import { useCallback } from 'react';

import { createChatBranch } from '../lib/branch';
import { deriveTitle } from '../lib/sessions';
import type { CreateChat, WorkspaceChat } from './workspace-chat';
import { errorMessage } from '@agent/core/errors.js';

export type ChatBranchOptions = {
  transitionIntent: React.RefObject<number>;
  active: WorkspaceChat;
  api: typeof fetch;
  refresh: () => Promise<void>;
  setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>>;
  createChat: CreateChat;
  setSessionError: (error: string) => void;
};

/** Branching selects the copy at once; saving follows and never gates the switch. */
export function useChatBranch({
  transitionIntent,
  active,
  refresh,
  setActive,
  createChat,
  setSessionError,
}: ChatBranchOptions) {
  const branchFrom = useCallback(
    async (throughIndex: number) => {
      // Read at call time: a stable callback keeps streamed messages from re-rendering branch controls.
      const { chat } = active;
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;

      // Supersede any chat that is still loading; the branch is the newest choice.
      transitionIntent.current++;

      const next = createChatBranch(chat.messages, throughIndex, active.id);
      const branch = createChat(next.id, next.messages, next.parentId, next.title, active.model.current);
      branch.branch = {
        parentTitle: active.title ?? deriveTitle(chat.messages),
        messageCount: next.messages.length,
      };

      setActive(branch);

      await saveBranch(active, branch, setSessionError);
      void refresh();
    },
    [active, createChat, refresh, setActive, setSessionError, transitionIntent],
  );

  return { branchFrom };
}

/** The parent is written first so the lineage target exists on disk. */
async function saveBranch(parent: WorkspaceChat, branch: WorkspaceChat, setSessionError: (error: string) => void) {
  try {
    await parent.save();
    await branch.save();

    setSessionError('');
  } catch (error) {
    // The branch stays open and listed; its own save notice offers a retry.
    setSessionError(errorMessage(error, 'Could not save the branched chat.'));
  }
}
