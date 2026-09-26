import type { AttemptRecord, FeedbackRecord, LearningEvent } from './types.js';
import { effectiveFeedback, type LearningStore } from './store.js';
import { redactSecrets } from './redact.js';

export type ExportType = 'eval' | 'embedding' | 'openai-chat' | 'query-positive-negative' | 'preference' | 'knowledge';

export async function exportDataset(store: LearningStore, type: ExportType): Promise<unknown[]> {
  if (type === 'knowledge') return (await store.knowledgeArtifacts()).map((artifact) => ({
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
  const attempts = uniqueAttempts(events);
  if (type === 'eval') return attempts.map((attempt) => evalRecord(attempt, feedback.get(attempt.attempt_id)));
  if (type === 'preference') return preferenceRecords(attempts, feedback);
  const solved = attempts.filter((attempt) =>
    feedback.get(attempt.attempt_id)?.label === 'solved' && attempt.user_query.trim() && attempt.answer.trim(),
  );
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
    const negative = [...new Set(attempt.retrieved_results
      .filter((hit) => !used.has(resultKey(hit)))
      .map(documentText).filter((text) => text && !positive.includes(text)))];
    return [{ query: redactSecrets(attempt.user_query), positive, negative }];
  });
  return attempts
        .filter((attempt) => feedback.get(attempt.attempt_id)?.rating === 3 && attempt.evidence_used.length > 0)
        .map((attempt) => embeddingRecord(attempt));
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
    byPrompt.set(key, [...(byPrompt.get(key) ?? []), attempt]);
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

function evalRecord(attempt: AttemptRecord, feedback?: FeedbackRecord): unknown {
  return {
    interaction_id: attempt.interaction_id,
    attempt_id: attempt.attempt_id,
    query: attempt.user_query,
    relevant_files: [...new Set(attempt.evidence_used.flatMap((hit) => (hit.path ? [hit.path] : [])))],
    relevant_symbols: [...new Set(attempt.evidence_used.flatMap((hit) => (hit.symbol ? [hit.symbol] : [])))],
    rating: feedback?.rating,
    label: feedback?.label,
    answer: redactSecrets(attempt.answer),
    feedback_reason: feedback?.reason ? redactSecrets(feedback.reason) : undefined,
    schema_version: 1,
    evidence_label: 'answer_referenced_unverified',
    repositories: attempt.repositories.map((repository) => ({
      name: repository.path.split(/[\\/]/).at(-1),
      branch: repository.branch,
      commit: repository.commit,
    })),
  };
}

function embeddingRecord(attempt: AttemptRecord): unknown {
  const positive = new Set(attempt.evidence_used.map(resultKey));
  return {
    interaction_id: attempt.interaction_id,
    query: attempt.user_query,
    positive_chunks: attempt.evidence_used,
    hard_negative_chunks: attempt.retrieved_results.filter((hit) => !positive.has(resultKey(hit))),
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
