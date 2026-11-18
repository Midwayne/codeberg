import { basename } from 'node:path';

import type { AttemptRecord, RetrievedResult } from '../types.js';
import { sourceKey, type SourceRef } from './reading.js';

const MAX_REFS = 12;
const MAX_CONSULTED = 6;

/**
 * Files an answer relied on. Files the answer names come first; files the agent
 * read or searched follow, because answers often describe code without quoting
 * its exact path, and a confirmed answer should not lose its evidence for that.
 */
export function evidenceRefs(attempt: AttemptRecord): SourceRef[] {
  const byKey = new Map<string, SourceRef>();
  const add = (hits: Pick<RetrievedResult, 'repo' | 'path' | 'symbol'>[], limit: number) => {
    for (const hit of hits) {
      if (byKey.size >= limit) return;

      const ref = refFor(attempt, hit);
      if (ref) byKey.set(sourceKey(ref), ref);
    }
  };

  add(attempt.evidence_used, MAX_REFS);
  add(consulted(attempt), Math.min(MAX_REFS, byKey.size + MAX_CONSULTED));

  return [...byKey.values()];
}

/** Read results before search results; within each, files the answer mentions by name first. */
function consulted(attempt: AttemptRecord): Pick<RetrievedResult, 'repo' | 'path' | 'symbol'>[] {
  const mentioned = (path: string) => attempt.answer.includes(basename(path));
  const read = (hit: RetrievedResult) => /open|read/i.test(hit.tool) || hit.opened === true;
  const score = (hit: RetrievedResult) =>
    (hit.path && mentioned(hit.path) ? 0 : 2) + (read(hit) ? 0 : 1);

  const results = attempt.retrieved_results
    .filter((hit) => hit.path)
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => score(a.hit) - score(b.hit) || a.index - b.index)
    .map(({ hit }) => hit);

  const inspected = (attempt.files_inspected ?? []).filter(mentioned).map((path) => ({ path }));

  return [...inspected, ...results];
}

function refFor(
  attempt: AttemptRecord,
  hit: Pick<RetrievedResult, 'repo' | 'path' | 'symbol'>,
): SourceRef | undefined {
  if (!hit.path) return undefined;

  const repositories = attempt.repositories;
  const repo =
    repositories.find((entry) => entry.path === hit.repo || basename(entry.path) === hit.repo) ??
    (repositories.length === 1 ? repositories[0] : undefined);
  if (!repo) return undefined;

  return { repo: repo.path, path: hit.path, ...(hit.symbol ? { symbol: hit.symbol } : {}) };
}
