import type { UIMessage } from 'ai';

import type {
  SessionFlags,
  SessionRecord as StoredSession,
  SessionSummary,
} from '@agent/core/api/sessions.js';
import { titleFromText } from '@agent/core/title.js';
import { jsonRequest } from './response.js';

export type SessionRecord = StoredSession<UIMessage>;

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
  flags: SessionFlags,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, jsonRequest('PATCH', flags));
  if (!response.ok) throw new Error(`Could not update chat (${response.status})`);
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
};

export async function saveSession(input: SaveSessionInput, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(
    `${BASE}/${encodeURIComponent(input.id)}`,
    jsonRequest('PUT', {
      title: input.title,
      messages: input.messages,
      ...(input.parentId ? { parentId: input.parentId } : {}),
    }),
  );
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

export function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const text = (firstUser?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ');
  return titleFromText(text, 'New chat');
}
