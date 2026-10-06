import type { UIMessage } from 'ai';

import { titleFromText } from '@agent/core/title.js';

/** Sidebar row — mirrors the server's WebSessionSummary. */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  parentId?: string;
  pinned: boolean;
  archived: boolean;
}

/** Full saved chat — UI messages verbatim, so a resume re-renders faithfully. */
export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  parentId?: string;
  pinned?: boolean;
  archived?: boolean;
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
  const response = await fetcher(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flags),
  });
  if (!response.ok) throw new Error(`Could not update chat (${response.status})`);
}

export async function loadSession(id: string, fetcher: typeof fetch = fetch): Promise<SessionRecord | null> {
  try {
    const res = await fetcher(`${BASE}/${encodeURIComponent(id)}`);
    return res.ok ? ((await res.json()) as SessionRecord) : null;
  } catch {
    return null;
  }
}

export type SaveSessionInput = {
  id: string;
  title: string;
  messages: UIMessage[];
  parentId?: string;
};

export async function saveSession(input: SaveSessionInput, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher(`${BASE}/${encodeURIComponent(input.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        messages: input.messages,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      }),
    });
  } catch {
    // Best-effort: a failed save must never disrupt the live chat.
  }
}

export async function deleteSession(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // ignore — the sidebar refresh will reconcile
  }
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
