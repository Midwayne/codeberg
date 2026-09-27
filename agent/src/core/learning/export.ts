import type { AttemptRecord, FeedbackRecord, LearningEvent } from './types.js';
import { effectiveFeedback, type LearningStore } from './store.js';
import { redactSecrets } from './redact.js';
import { DatasetStore, exampleFiles } from './datasets.js';
import { sameTaskFamily } from './dedup.js';
import { interactionRevisions } from './revision.js';

export type ExportType = 'eval' | 'embedding' | 'openai-chat' | 'query-positive-negative' | 'preference' | 'knowledge';

export async function exportDataset(store: LearningStore, type: ExportType): Promise<unknown[]> {
  if (type === 'knowledge') return (await store.currentKnowledgeArtifacts()).map((artifact) => ({
    schema_version: 1,
    record_type: 'knowledge_artifact',
    id: artifact.id,
    category: artifact.category,
    title: redactSecrets(artifact.title),
    body: redactSecrets(artifact.body),
    status: artifact.status,
    confidence: artifact.confidence,
    source_interactions: artifact.source_interactions,
    source_commits: artifact.source_commits,
    updated_at: artifact.updated_at,
  }));
  const events = await store.events();
  const feedback = effectiveFeedback(events);
  const allAttempts = uniqueAttempts(events);
  const revisions = interactionRevisions(events);
  const datasets = new DatasetStore(store);
  const heldOut = await datasets.list('eval');
  if (type === 'eval') return datasets.active('eval');
  const training = await datasets.active('training');
  const requiredKind = type === 'openai-chat' ? ['sft'] : type === 'preference' ? ['preferences'] : ['retrieval', 'hard_negatives', 'hard_negative_candidates'];
  const attempts = allAttempts.filter((attempt) => {
    const approved = training.some((row) => row.source_interaction_id === attempt.interaction_id &&
      row.source_revision === revisions.get(attempt.interaction_id) && requiredKind.includes(row.kind));
    const inEvalFamily = heldOut.some((row) => row.source_interaction_id === attempt.interaction_id ||
      sameTaskFamily(
        { query: row.query, files: exampleFiles(row) },
        { query: attempt.user_query, files: attempt.evidence_used.map((hit) => hit.path).filter((path): path is string => Boolean(path)) },
      ));
    return approved && !inEvalFamily;
  });
  if (type === 'preference') return preferenceRecords(attempts, feedback);
  const latest = new Map(attempts.map((attempt) => [attempt.interaction_id, attempt.attempt_id]));
  const solved = attempts.filter((attempt) => latest.get(attempt.interaction_id) === attempt.attempt_id &&
    feedback.get(attempt.attempt_id)?.label === 'solved' && attempt.user_query.trim() && attempt.answer.trim());
  if (type === 'openai-chat') return solved
    .filter((attempt) => !attempt.parent_interaction_id &&
      !/^(?:no\b|actually\b|i meant\b|that's not\b|that is not\b|but\b)/i.test(attempt.user_query))
    .map((attempt) => ({ messages: [
      { role: 'user', content: redactSecrets(attempt.user_query) },
      { role: 'assistant', content: redactSecrets(attempt.answer) },
    ] }));
  if (type === 'query-positive-negative') return solved.flatMap((attempt) => {
    const positive = [...new Set(attempt.evidence_used.map(documentText).filter((text) => text))];
    if (!positive.length) return [];
    const used = new Set(attempt.evidence_used.map(resultKey));
    const verifiedNegatives = approvedNegatives(training, attempt.interaction_id, revisions.get(attempt.interaction_id));
    const negative = [...new Set(attempt.retrieved_results
      .filter((hit) => hit.path && verifiedNegatives.has(hit.path) && !used.has(resultKey(hit)))
      .map(documentText).filter((text) => text && !positive.includes(text)))];
    return [{ query: redactSecrets(attempt.user_query), positive, negative }];
  });
  return attempts
    .filter((attempt) => feedback.get(attempt.attempt_id)?.rating === 3 && attempt.evidence_used.length > 0)
    .map((attempt) => embeddingRecord(attempt,
      approvedNegatives(training, attempt.interaction_id, revisions.get(attempt.interaction_id))));
}

function approvedNegatives(training: Awaited<ReturnType<DatasetStore['active']>>, interactionId: string, revision?: string): Set<string> {
  const rows = training.filter((row) => row.source_interaction_id === interactionId && row.source_revision === revision &&
    (row.kind === 'hard_negatives' || row.kind === 'hard_negative_candidates'));
  const paths = rows.flatMap((row) => {
    const reviewed = row.review?.oracle?.verified_negatives;
    if (Array.isArray(reviewed)) return reviewed.filter((path): path is string => typeof path === 'string');
    if (row.kind !== 'hard_negatives' || !Array.isArray(row.payload.hard_negatives)) return [];
    return row.payload.hard_negatives.flatMap((hit) =>
      hit && typeof hit === 'object' && typeof hit.path === 'string' ? [hit.path] : []);
  });
  return new Set(paths);
}

function documentText(hit: AttemptRecord['retrieved_results'][number]): string {
  if (!hit.snippet?.trim()) return '';
  return redactSecrets([hit.repo, hit.path, hit.symbol, hit.snippet].filter(Boolean).join('\n'));
}

function preferenceRecords(attempts: AttemptRecord[], feedback: Map<string, FeedbackRecord>): unknown[] {
  const byPrompt = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    if (!feedback.has(attempt.attempt_id) || !attempt.answer.trim()) continue;
    const key = `${attempt.interaction_id}\0${attempt.user_query}`;
    const group = byPrompt.get(key) ?? [];
    group.push(attempt);
    byPrompt.set(key, group);
  }
  const rows: unknown[] = [];
  for (const group of byPrompt.values()) {
    const chosen = group.find((attempt) => feedback.get(attempt.attempt_id)?.label === 'solved');
    const rejected = group.find((attempt) => (feedback.get(attempt.attempt_id)?.rating ?? 3) < 2 && attempt.answer !== chosen?.answer);
    if (!chosen || !rejected) continue;
    rows.push({
      prompt: [{ role: 'user', content: redactSecrets(chosen.user_query) }],
      chosen: [{ role: 'assistant', content: redactSecrets(chosen.answer) }],
      rejected: [{ role: 'assistant', content: redactSecrets(rejected.answer) }],
    });
  }
  return rows;
}

function embeddingRecord(attempt: AttemptRecord, verifiedNegatives: Set<string>): unknown {
  const positive = new Set(attempt.evidence_used.map(resultKey));
  return {
    interaction_id: attempt.interaction_id,
    query: attempt.user_query,
    positive_chunks: attempt.evidence_used,
    hard_negative_chunks: attempt.retrieved_results.filter((hit) => hit.path && verifiedNegatives.has(hit.path) && !positive.has(resultKey(hit))),
  };
}

function resultKey(hit: AttemptRecord['retrieved_results'][number]): string {
  return `${hit.repo ?? ''}:${hit.path ?? ''}:${hit.symbol ?? ''}:${hit.start_line ?? ''}`;
}

function uniqueAttempts(events: LearningEvent[]): AttemptRecord[] {
  const attempts = new Map<string, AttemptRecord>();
  for (const event of events) {
    if (event.type === 'attempt_recorded') attempts.set(event.attempt.attempt_id, event.attempt);
  }
  return [...attempts.values()];
}
