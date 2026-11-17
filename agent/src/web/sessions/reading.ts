import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { messageSearchHits } from '../../core/session-search.js';
import {
  type WebSessionRecord,
  type WebSessionSearchResult,
  type WebSessionSummary,
  countTurns,
} from './records.js';
import type { WebSessionStoreState } from './state.js';

export async function load(
  state: WebSessionStoreState,
  id: string,
): Promise<WebSessionRecord | null> {
  try {
    const raw = await readFile(join(state.dir, `${id}.json`), 'utf8');

    return JSON.parse(raw) as WebSessionRecord;
  } catch {
    return null;
  }
}

type Match = { summary: WebSessionSummary; record: WebSessionRecord };

export async function list(state: WebSessionStoreState, query = ''): Promise<WebSessionSummary[]> {
  if (!query.trim()) return listAll(state);

  return (await matching(state, query)).map((match) => match.summary);
}

/**
 * The unfiltered sidebar list runs after every save, so it re-reads only chats
 * whose files changed since the last listing (other processes included).
 */
async function listAll(state: WebSessionStoreState): Promise<WebSessionSummary[]> {
  const ids = await chatIds(state);
  const summaries: WebSessionSummary[] = [];

  for (const id of ids) {
    const summary = await cachedSummary(state, id);
    if (summary) summaries.push(summary);
  }

  for (const id of state.summaries.keys()) {
    if (!ids.includes(id)) state.summaries.delete(id);
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function cachedSummary(state: WebSessionStoreState, id: string): Promise<WebSessionSummary | undefined> {
  const info = await stat(join(state.dir, `${id}.json`), { bigint: true }).catch(() => undefined);
  if (!info) return undefined;

  const version = `${info.ino}:${info.size}:${info.mtimeNs}`;
  const cached = state.summaries.get(id);
  if (cached?.version === version) return cached.summary;

  const record = await load(state, id);
  if (!record) return undefined;

  const summary = summarize(record);
  state.summaries.set(id, { version, summary });

  return summary;
}

async function chatIds(state: WebSessionStoreState): Promise<string[]> {
  const files = await readdir(state.dir).catch(() => [] as string[]);

  return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length));
}

/** Loads each saved chat once; callers that need message text reuse the record. */
async function matching(state: WebSessionStoreState, query: string): Promise<Match[]> {
  const matches: Match[] = [];
  const needle = query.trim().toLocaleLowerCase();
  for (const id of await chatIds(state)) {
    const record = await load(state, id);
    if (
      record &&
      (!needle ||
        record.title.toLocaleLowerCase().includes(needle) ||
        messageSearchHits(record.messages, needle).length > 0)
    ) {
      matches.push({ summary: summarize(record), record });
    }
  }

  return matches.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
}

function summarize(record: WebSessionRecord): WebSessionSummary {
  return {
    id: record.id,
    title: record.title,
    updatedAt: record.updatedAt,
    turns: countTurns(record.messages),
    pinned: record.pinned === true,
    archived: record.archived === true,
    ...(record.parentId ? { parentId: record.parentId } : {}),
  };
}

export async function search(
  state: WebSessionStoreState,
  query: string,
): Promise<WebSessionSearchResult[]> {
  if (!query.trim()) return [];

  const results: WebSessionSearchResult[] = [];
  for (const { summary, record } of await matching(state, query)) {
    if (record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) {
      results.push({ ...summary, role: 'title', snippet: record.title });
    }

    for (const hit of messageSearchHits(record.messages, query)) {
      results.push({ ...summary, ...hit });
      if (results.length >= 100) break;
    }

    if (results.length >= 100) break;
  }

  return results;
}
