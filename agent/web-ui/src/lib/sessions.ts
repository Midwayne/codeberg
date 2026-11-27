import type { UIMessage } from 'ai';

import { titleFromMessages } from '@agent/core/title.js';
import { jsonInit } from './http';
import type { ModelSelection } from './models';

/** Sidebar row — mirrors the server's WebSessionSummary. */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
  pinned: boolean;
  archived: boolean;
  /** A finished reply the user has not opened yet. */
  unread?: boolean;
}

/** Full saved chat — UI messages verbatim, so a resume re-renders faithfully. */
interface SessionRecord {
  serverRunId?: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  parentId?: string;
  pinned?: boolean;
  archived?: boolean;
  /** This chat's own model; absent follows the default from Models. */
  model?: ModelSelection;
}

const BASE = '/api/sessions';

/** All saved chats, newest first. Network/parse errors yield an empty list. */
export async function listSessions(query = '', fetcher: typeof fetch = fetch): Promise<SessionSummary[]> {
  try {
    const res = await fetcher(query.trim() ? `${BASE}?q=${encodeURIComponent(query.trim())}` : BASE);
    return res.ok ? ((await res.json()) as SessionSummary[]) : [];
  } catch {
    return [];
  }
}

export async function updateSessionFlags(
  id: string,
  flags: { pinned?: boolean; archived?: boolean },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PATCH', flags));
  if (!response.ok) throw new Error(`Could not update chat (${response.status})`);
}

export async function renameSession(id: string, title: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PATCH', { title }));
  if (!response.ok) throw new Error(`Could not rename chat (${response.status})`);
}

/** Saves the chat's own model, or `null` to follow the default again. */
export async function setSessionModel(id: string, model: ModelSelection | null, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PATCH', { model }));
  if (!response.ok) throw new Error(`Could not save the chat's model (${response.status})`);
}

/** Clears the chat's unread mark without reordering the sidebar. */
export async function markSessionRead(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PATCH', { read: true }));
  if (!response.ok && response.status !== 404) throw new Error(`Could not mark chat read (${response.status})`);
}

/** Interactive opens must distinguish a missing chat from a failed request. */
export async function readSession(id: string, fetcher: typeof fetch = fetch): Promise<SessionRecord | null> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load chat (${response.status}). Try again.`);

  return (await response.json()) as SessionRecord;
}

export type SaveSessionInput = {
  id: string;
  title: string;
  messages: UIMessage[];
  parentId?: string;
  /** `null` follows the default model; absent leaves the saved choice alone. */
  model?: ModelSelection | null;
};

export async function saveSession(input: SaveSessionInput, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(input.id)}`, jsonInit('PUT', {
      title: input.title,
      messages: input.messages,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.model === undefined ? {} : { model: input.model }),
    }));
  if (!response.ok) throw new Error(`Could not save chat (${response.status})`);
}

export async function deleteSession(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Could not delete chat (${response.status})`);
}

/** A short, file-safe id, within the server's `[A-Za-z0-9_-]{1,64}` guard. */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const deriveTitle = titleFromMessages;
