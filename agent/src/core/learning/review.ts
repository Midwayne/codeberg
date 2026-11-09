import { isCurrentExample } from './dataset-extract.js';
import { type DatasetExample, type DatasetKind } from './datasets/records.js';
import { type DatasetStore } from './datasets.js';
import { interactionRevisions } from './revision.js';
import { answerFromPayload, verifierProposedFiles } from './review-payload.js';
import type { ReviewCandidate, ReviewDashboard, ReviewState } from './review-types.js';

export type { ReviewCandidate, ReviewDashboard, ReviewState };
export { answerFromPayload, verifierProposedFiles } from './review-payload.js';

export async function reviewDashboard(datasets: DatasetStore): Promise<ReviewDashboard> {
  const [candidates, training, evalRows, dismissed, events] = await Promise.all([
    datasets.list('candidates'),
    datasets.list('training'),
    datasets.list('eval'),
    datasets.list('dismissed'),
    datasets.store.events(),
  ]);

  const revisions = interactionRevisions(events);
  const trainingIds = new Set(training.map((row) => row.id));
  const evalIds = new Set(evalRows.map((row) => row.id));
  const dismissedIds = new Set(dismissed.map((row) => row.id));
  const summary = candidates
    .map((row): ReviewCandidate => {
      return summarizeCandidate(row, revisions, trainingIds, evalIds, dismissedIds);
    })
    .sort((a, b) => b.extracted_at.localeCompare(a.extracted_at));

  const by_kind: Partial<Record<DatasetKind, number>> = {};
  for (const row of summary.filter((candidate) => candidate.state === 'ready')) {
    by_kind[row.kind] = (by_kind[row.kind] ?? 0) + 1;
  }

  return {
    stats: {
      total: summary.length,
      ready: summary.filter((row) => row.state === 'ready').length,
      training: summary.filter((row) => row.state === 'training').length,
      eval: summary.filter((row) => row.state === 'eval').length,
      dismissed: summary.filter((row) => row.state === 'dismissed').length,
      stale: summary.filter((row) => row.state === 'stale').length,
      by_kind,
    },
    candidates: summary,
  };
}

export function answerFor(row: DatasetExample): string {
  return answerFromPayload(row.payload);
}

export function proposedFiles(row: DatasetExample): string[] {
  const values = [
    row.payload.proposed_evidence,
    row.payload.positive,
    row.payload.proposed_negatives,
    row.payload.hard_negatives,
  ];

  const paths = values
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .flatMap((hit) =>
      hit && typeof hit === 'object' && typeof hit.path === 'string' ? [hit.path] : [],
    );

  return [...new Set([...paths, ...verifierProposedFiles(row.payload.verifier)])];
}

function summarizeCandidate(
  row: DatasetExample,
  revisions: Map<string, string>,
  trainingIds: Set<string>,
  evalIds: Set<string>,
  dismissedIds: Set<string>,
): ReviewCandidate {
  const eligible = isCurrentExample(row, revisions.get(row.source_interaction_id));
  const state: ReviewState = !eligible
    ? 'stale'
    : trainingIds.has(row.id)
      ? 'training'
      : evalIds.has(row.id)
        ? 'eval'
        : dismissedIds.has(row.id)
          ? 'dismissed'
          : 'ready';

  return {
    id: row.id,
    kind: row.kind,
    query: row.query,
    extracted_at: row.extracted_at,
    state,
    eligible,
    feedback: row.feedback.at(-1)
      ? { label: row.feedback.at(-1)!.label, reason: row.feedback.at(-1)!.reason }
      : undefined,
    repositories: row.repositories.map((repo) => repo.name),
    answer_preview: answerFor(row).slice(0, 240),
    proposed_files: proposedFiles(row),
  };
}
