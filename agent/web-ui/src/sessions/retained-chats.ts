import type { WorkspaceChat } from './workspace-chat';

const MAX_CHAT_VIEWS = 3;

/** Bound retained DOM without disposing independently running conversations. */
export function retainChatViews(views: WorkspaceChat[], active: WorkspaceChat): WorkspaceChat[] {
  const recent = views.filter((chat) => chat.id !== active.id && !chat.disposed);

  return [active, ...recent].slice(0, MAX_CHAT_VIEWS);
}
