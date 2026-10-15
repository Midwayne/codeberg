import { deriveTitle, type SessionSummary } from '../lib/sessions';
import type { WorkspaceChat } from './workspace-chat';

/** Local submitted chats remain reachable even when their first save fails. */
export function workspaceSummaries(saved: SessionSummary[], chats: Map<string, WorkspaceChat>): SessionSummary[] {
  const summaries = new Map(saved.map((session) => [session.id, session]));

  for (const chat of chats.values()) {
    if (chat.disposed || !chat.chat.messages.length || summaries.has(chat.id)) continue;

    summaries.set(chat.id, {
      id: chat.id,
      title: chat.title ?? deriveTitle(chat.chat.messages),
      updatedAt: chat.createdAt,
      turns: chat.chat.messages.filter((message) => message.role === 'user').length,
      parentId: chat.parentId,
      pinned: false,
      archived: false,
    });
  }

  return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
