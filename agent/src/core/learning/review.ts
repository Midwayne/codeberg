import { EXTRACTION_VERSION, type DatasetExample, type DatasetKind, type DatasetStore } from './datasets.js';
import { interactionRevisions } from './revision.js';

export type ReviewState = 'ready' | 'training' | 'eval' | 'dismissed' | 'stale';

export interface ReviewCandidate {
  id: string;
  kind: DatasetKind;
  query: string;
  extracted_at: string;
  state: ReviewState;
  eligible: boolean;
  feedback?: { label: string; reason?: string };
  repositories: string[];
  answer_preview: string;
  proposed_files: string[];
}

export interface ReviewDashboard {
  stats: {
    total: number;
    ready: number;
    training: number;
    eval: number;
    dismissed: number;
    stale: number;
    by_kind: Partial<Record<DatasetKind, number>>;
  };
  candidates: ReviewCandidate[];
}

export async function reviewDashboard(datasets: DatasetStore): Promise<ReviewDashboard> {
  const [candidates, training, evalRows, dismissed, events] = await Promise.all([
    datasets.list('candidates'), datasets.list('training'), datasets.list('eval'),
    datasets.list('dismissed'), datasets.store.events(),
  ]);
  const revisions = interactionRevisions(events);
  const trainingIds = new Set(training.map((row) => row.id));
  const evalIds = new Set(evalRows.map((row) => row.id));
  const dismissedIds = new Set(dismissed.map((row) => row.id));
  const summary = candidates.map((row): ReviewCandidate => {
    const eligible = row.extraction_version === EXTRACTION_VERSION &&
      row.source_revision === revisions.get(row.source_interaction_id);
    const state: ReviewState = !eligible ? 'stale' : trainingIds.has(row.id) ? 'training' :
      evalIds.has(row.id) ? 'eval' : dismissedIds.has(row.id) ? 'dismissed' : 'ready';
    return {
      id: row.id, kind: row.kind, query: row.query, extracted_at: row.extracted_at, state, eligible,
      feedback: row.feedback.at(-1) ? { label: row.feedback.at(-1)!.label, reason: row.feedback.at(-1)!.reason } : undefined,
      repositories: row.repositories.map((repo) => repo.name),
      answer_preview: answerFor(row).slice(0, 240),
      proposed_files: proposedFiles(row),
    };
  }).sort((a, b) => b.extracted_at.localeCompare(a.extracted_at));
  const by_kind: Partial<Record<DatasetKind, number>> = {};
  for (const row of summary.filter((candidate) => candidate.state === 'ready')) {
    by_kind[row.kind] = (by_kind[row.kind] ?? 0) + 1;
  }
  return { stats: {
    total: summary.length, ready: summary.filter((row) => row.state === 'ready').length,
    training: summary.filter((row) => row.state === 'training').length,
    eval: summary.filter((row) => row.state === 'eval').length,
    dismissed: summary.filter((row) => row.state === 'dismissed').length,
    stale: summary.filter((row) => row.state === 'stale').length,
    by_kind,
  }, candidates: summary };
}

export function answerFor(row: DatasetExample): string {
  const payload = row.payload;
  if (typeof payload.answer === 'string') return payload.answer;
  if (typeof payload.chosen === 'string') return payload.chosen;
  const trajectory = payload.successful_trajectory ?? payload.trajectory;
  return Array.isArray(trajectory) ? String(trajectory.at(-1)?.answer ?? '') : '';
}

export function proposedFiles(row: DatasetExample): string[] {
  const values = [row.payload.proposed_evidence, row.payload.positive, row.payload.proposed_negatives,
    row.payload.hard_negatives];
  const paths = values.flatMap((value) => Array.isArray(value) ? value : [])
    .flatMap((hit) => hit && typeof hit === 'object' && typeof hit.path === 'string' ? [hit.path] : []);
  const verifier = row.payload.verifier;
  const proposed = verifier && typeof verifier === 'object' && 'proposed_files' in verifier &&
    Array.isArray(verifier.proposed_files) ? verifier.proposed_files.filter((path): path is string => typeof path === 'string') : [];
  return [...new Set([...paths, ...proposed])];
}
