import type { WorkspaceChat, WorkspaceChatSave } from './workspace-chat';

export function canReloadChat(chat: WorkspaceChat): boolean {
  const queue = chat.turns.getSnapshot();
  const saving = chat.persistence.getSnapshot();

  return !chat.disposed && !chat.turns.busy && chat.chat.status === 'ready' && !queue.items.length && !queue.steering
    && !queue.error && !saving.error && !saving.retrying;
}

/** Keep the SDK instance so mounted message subscribers continue to receive updates. */
export async function reloadWorkspaceChat(workspace: WorkspaceChat, record: WorkspaceChatSave,
  settled: () => Promise<void>, reset: () => void): Promise<boolean> {
  await settled();
  if (!canReloadChat(workspace)) return false;

  reset();
  workspace.title = record.title;
  workspace.parentId = record.parentId;
  workspace.chat.messages = record.messages;

  return true;
}
