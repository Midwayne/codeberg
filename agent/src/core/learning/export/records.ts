import { DatasetStore } from '../datasets.js';
import { redactSecrets } from '../redact.js';
import type { AttemptRecord, FeedbackRecord } from '../types.js';

export function chatRecords(solved: AttemptRecord[]): unknown[] {
  return solved
    .filter(
      (attempt) =>
        !attempt.parent_interaction_id &&
        !/^(?:no\b|actually\b|i meant\b|that's not\b|that is not\b|but\b)/i.test(
          attempt.user_query,
        ),
    )
    .map((attempt) => ({
      messages: [
        { role: 'user', content: redactSecrets(attempt.user_query) },
        { role: 'assistant', content: redactSecrets(attempt.answer) },
      ],
    }));
}

export function retrievalRecords(
  solved: AttemptRecord[],
  training: Awaited<ReturnType<DatasetStore['active']>>,
  revisions: Map<string, string>,
): unknown[] {
  return solved.flatMap((attempt) => {
    const positive = [...new Set(attempt.evidence_used.map(documentText).filter((text) => text))];
    if (!positive.length) return [];

    const used = new Set(attempt.evidence_used.map(resultKey));
    const verifiedNegatives = approvedNegatives(
      training,
      attempt.interaction_id,
      revisions.get(attempt.interaction_id),
    );

    const negative = [
      ...new Set(
        attempt.retrieved_results
          .filter((hit) => hit.path && verifiedNegatives.has(hit.path) && !used.has(resultKey(hit)))
          .map(documentText)
          .filter((text) => text && !positive.includes(text)),
      ),
    ];

    return [{ query: redactSecrets(attempt.user_query), positive, negative }];
  });
}

export function approvedNegatives(
  training: Awaited<ReturnType<DatasetStore['active']>>,
  interactionId: string,
  revision?: string,
): Set<string> {
  const rows = training.filter(
    (row) =>
      row.source_interaction_id === interactionId &&
      row.source_revision === revision &&
      (row.kind === 'hard_negatives' || row.kind === 'hard_negative_candidates'),
  );

  const paths = rows.flatMap((row) => {
    const reviewed = row.review?.oracle?.verified_negatives;
    if (Array.isArray(reviewed))
      return reviewed.filter((path): path is string => typeof path === 'string');

    if (row.kind !== 'hard_negatives' || !Array.isArray(row.payload.hard_negatives)) return [];

    return row.payload.hard_negatives.flatMap((hit) =>
      hit && typeof hit === 'object' && typeof hit.path === 'string' ? [hit.path] : [],
    );
  });

  return new Set(paths);
}

export function documentText(hit: AttemptRecord['retrieved_results'][number]): string {
  if (!hit.snippet?.trim()) return '';

  return redactSecrets([hit.repo, hit.path, hit.symbol, hit.snippet].filter(Boolean).join('\n'));
}

export function preferenceRecords(
  attempts: AttemptRecord[],
  feedback: Map<string, FeedbackRecord>,
): unknown[] {
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
    const rejected = group.find(
      (attempt) =>
        (feedback.get(attempt.attempt_id)?.rating ?? 3) < 2 && attempt.answer !== chosen?.answer,
    );

    if (!chosen || !rejected) continue;

    rows.push({
      prompt: [{ role: 'user', content: redactSecrets(chosen.user_query) }],
      chosen: [{ role: 'assistant', content: redactSecrets(chosen.answer) }],
      rejected: [{ role: 'assistant', content: redactSecrets(rejected.answer) }],
    });
  }

  return rows;
}

export function embeddingRecord(attempt: AttemptRecord, verifiedNegatives: Set<string>): unknown {
  const positive = new Set(attempt.evidence_used.map(resultKey));

  return {
    interaction_id: attempt.interaction_id,
    query: attempt.user_query,
    positive_chunks: attempt.evidence_used,
    hard_negative_chunks: attempt.retrieved_results.filter(
      (hit) => hit.path && verifiedNegatives.has(hit.path) && !positive.has(resultKey(hit)),
    ),
  };
}

export function resultKey(hit: AttemptRecord['retrieved_results'][number]): string {
  return `${hit.repo ?? ''}:${hit.path ?? ''}:${hit.symbol ?? ''}:${hit.start_line ?? ''}`;
}
