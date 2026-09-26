import type { UIMessage } from 'ai';

import { messageSearchHits } from '@agent/core/session-search.js';

export interface ChatSearchResult {
  id: string;
  title: string;
  role: 'assistant' | 'user' | 'title';
  messageId?: string;
  snippet: string;
  archived: boolean;
  pinned: boolean;
  updatedAt: number;
}

/** Live current-chat answers first, then its prompts, then all other saved chats. */
export function rankChatResults(
  query: string,
  currentId: string,
  currentTitle: string,
  currentMessages: readonly UIMessage[],
  saved: readonly ChatSearchResult[],
  currentFlags: Pick<ChatSearchResult, 'archived' | 'pinned'> = { archived: false, pinned: false },
): { current: ChatSearchResult[]; others: ChatSearchResult[] } {
  if (!query.trim()) return { current: [], others: [] };
  const local = messageSearchHits(currentMessages, query).map((hit) => ({
    id: currentId, title: currentTitle, ...currentFlags,
    updatedAt: Date.now(), ...hit,
  }));
  const current = [
    ...local.filter((hit) => hit.role === 'assistant').reverse(),
    ...local.filter((hit) => hit.role === 'user').reverse(),
    ...(currentTitle.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      ? [{ id: currentId, title: currentTitle, role: 'title' as const, snippet: currentTitle, ...currentFlags, updatedAt: Date.now() }]
      : []),
  ];
  return { current, others: saved.filter((hit) => hit.id !== currentId) };
}

export async function searchChats(query: string, signal: AbortSignal): Promise<ChatSearchResult[]> {
  const response = await fetch(`/api/chat-search?q=${encodeURIComponent(query.trim())}`, { signal });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return response.json() as Promise<ChatSearchResult[]>;
}
