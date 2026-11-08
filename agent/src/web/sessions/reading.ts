import { join } from 'node:path';
import { readOptionalRecord, readRecordFiles } from '../../core/learning/fs.js';
import { messageSearchHits } from '../../core/session-search.js';
import type {
  SessionRecord,
  SessionSearchResult,
  SessionSummary,
} from '../../core/api/sessions.js';
import { countTurns } from './records.js';
import type { WebSessionStoreState } from './state.js';

export async function load(state: WebSessionStoreState, id: string): Promise<SessionRecord | null> {
  const record = await readOptionalRecord(
    join(state.dir, `${id}.json`),
    (raw) => JSON.parse(raw) as SessionRecord,
  );

  return record ?? null;
}

export async function list(state: WebSessionStoreState, query = ''): Promise<SessionSummary[]> {
  const records = await readRecordFiles(
    state.dir,
    (file) => file.endsWith('.json'),
    (raw) => JSON.parse(raw) as SessionRecord,
  );
  const summaries: SessionSummary[] = [];
  const needle = query.trim().toLocaleLowerCase();
  for (const record of records) {
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
): Promise<SessionSearchResult[]> {
  if (!query.trim()) return [];

  const summaries = await list(state, query);
  const results: SessionSearchResult[] = [];
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
