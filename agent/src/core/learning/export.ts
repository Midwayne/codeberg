import { DatasetStore, exampleFiles } from './datasets.js';
import { sameTaskFamily } from './dedup.js';
import {
  approvedNegatives,
  chatRecords,
  embeddingRecord,
  preferenceRecords,
  retrievalRecords,
} from './export/records.js';
import { redactSecrets } from './redact.js';
import { interactionRevisions } from './revision.js';
import { effectiveFeedback, type LearningStore } from './store.js';
import type { AttemptRecord, LearningEvent } from './types.js';

export type ExportType =
  | 'eval'
  | 'embedding'
  | 'openai-chat'
  | 'query-positive-negative'
  | 'preference'
  | 'knowledge';

export async function exportDataset(store: LearningStore, type: ExportType): Promise<unknown[]> {
  if (type === 'knowledge') return exportKnowledge(store);

  const events = await store.events();
  const feedback = effectiveFeedback(events);
  const allAttempts = uniqueAttempts(events);
  const revisions = interactionRevisions(events);
  const datasets = new DatasetStore(store);
  const heldOut = await datasets.list('eval');
  if (type === 'eval') return datasets.active('eval');

  const training = await datasets.active('training');
  const attempts = approvedAttempts(allAttempts, training, heldOut, revisions, type);

  if (type === 'preference') return preferenceRecords(attempts, feedback);

  const latest = new Map(attempts.map((attempt) => [attempt.interaction_id, attempt.attempt_id]));
  const solved = attempts.filter(
    (attempt) =>
      latest.get(attempt.interaction_id) === attempt.attempt_id &&
      feedback.get(attempt.attempt_id)?.label === 'solved' &&
      attempt.user_query.trim() &&
      attempt.answer.trim(),
  );

  if (type === 'openai-chat') return chatRecords(solved);

  if (type === 'query-positive-negative') return retrievalRecords(solved, training, revisions);

  return attempts
    .filter(
      (attempt) =>
        feedback.get(attempt.attempt_id)?.rating === 3 && attempt.evidence_used.length > 0,
    )
    .map((attempt) =>
      embeddingRecord(
        attempt,
        approvedNegatives(training, attempt.interaction_id, revisions.get(attempt.interaction_id)),
      ),
    );
}

function approvedAttempts(
  allAttempts: AttemptRecord[],
  training: Awaited<ReturnType<DatasetStore['active']>>,
  heldOut: Awaited<ReturnType<DatasetStore['list']>>,
  revisions: Map<string, string>,
  type: ExportType,
): AttemptRecord[] {
  const requiredKind =
    type === 'openai-chat'
      ? ['sft']
      : type === 'preference'
        ? ['preferences']
        : ['retrieval', 'hard_negatives', 'hard_negative_candidates'];

  return allAttempts.filter((attempt) => {
    const approved = training.some(
      (row) =>
        row.source_interaction_id === attempt.interaction_id &&
        row.source_revision === revisions.get(attempt.interaction_id) &&
        requiredKind.includes(row.kind),
    );

    const inEvalFamily = heldOut.some(
      (row) =>
        row.source_interaction_id === attempt.interaction_id ||
        sameTaskFamily(
          { query: row.query, files: exampleFiles(row) },
          {
            query: attempt.user_query,
            files: attempt.evidence_used
              .map((hit) => hit.path)
              .filter((path): path is string => Boolean(path)),
          },
        ),
    );

    return approved && !inEvalFamily;
  });
}

async function exportKnowledge(store: LearningStore): Promise<unknown[]> {
  return (await store.currentKnowledgeArtifacts()).map((artifact) => ({
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
}

function uniqueAttempts(events: LearningEvent[]): AttemptRecord[] {
  const attempts = new Map<string, AttemptRecord>();
  for (const event of events) {
    if (event.type === 'attempt_recorded') attempts.set(event.attempt.attempt_id, event.attempt);
  }

  return [...attempts.values()];
}
