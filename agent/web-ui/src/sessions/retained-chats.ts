import type { WorkspaceChat } from './workspace-chat';

// Keep a working set warm: cycling four chats must not rebuild every transcript.
// Hidden Activity trees release effects; the cap still bounds retained DOM.
const MAX_CHAT_VIEWS = 8;

/** Bound retained DOM without disposing independently running conversations. */
export function retainChatViews(views: WorkspaceChat[], active: WorkspaceChat): WorkspaceChat[] {
  const recent = views.filter((chat) => chat.id !== active.id && !chat.disposed);

  return [active, ...recent].slice(0, MAX_CHAT_VIEWS);
}
