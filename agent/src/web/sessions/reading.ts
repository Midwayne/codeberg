import { readFile, readdir } from 'node:fs/promises';
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

export async function list(state: WebSessionStoreState, query = ''): Promise<WebSessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(state.dir);
  } catch {
    return [];
  }

  const summaries: WebSessionSummary[] = [];
  const needle = query.trim().toLocaleLowerCase();
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }

    const record = await load(state, file.slice(0, -'.json'.length));
    if (
      record &&
      (!needle ||
        record.title.toLocaleLowerCase().includes(needle) ||
        messageSearchHits(record.messages, needle).length > 0)
    ) {
      summaries.push({
        id: record.id,
        title: record.title,
        updatedAt: record.updatedAt,
        turns: countTurns(record.messages),
        pinned: record.pinned === true,
        archived: record.archived === true,
        ...(record.parentId ? { parentId: record.parentId } : {}),
      });
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function search(
  state: WebSessionStoreState,
  query: string,
): Promise<WebSessionSearchResult[]> {
  if (!query.trim()) return [];

  const summaries = await list(state, query);
  const results: WebSessionSearchResult[] = [];
  for (const summary of summaries) {
    const record = await load(state, summary.id);
    if (!record) continue;

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
