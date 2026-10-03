import type { ReviewDashboard, ReviewSummary } from './training';

export type ReviewFilter = 'ready' | 'reviewed' | 'stale';
export type ReviewDecision = 'training' | 'eval' | 'dismiss';

export function reviewRows(rows: readonly ReviewSummary[], filter: ReviewFilter): ReviewSummary[] {
  return rows.filter((row) => filter === 'reviewed'
    ? ['training', 'eval', 'dismissed'].includes(row.state) : row.state === filter);
}

export function reviewSelection(rows: readonly ReviewSummary[], filter: ReviewFilter, current?: string): string | undefined {
  const visible = reviewRows(rows, filter);
  return visible.find((row) => row.id === current)?.id ?? visible[0]?.id;
}

/** A successful POST stays confirmed even if the following dashboard GET fails. */
export function applyReviewDecision(dashboard: ReviewDashboard, id: string, decision: ReviewDecision): ReviewDashboard {
  const candidates = dashboard.candidates.map((row) => row.id === id
    ? { ...row, state: decision === 'dismiss' ? 'dismissed' as const : decision } : row);
  const stats: ReviewDashboard['stats'] = { total: candidates.length, ready: 0, training: 0, eval: 0, dismissed: 0, stale: 0, by_kind: {} };
  for (const row of candidates) {
    stats[row.state]++;
    if (row.state === 'ready') stats.by_kind[row.kind] = (stats.by_kind[row.kind] ?? 0) + 1;
  }
  return { candidates, stats };
}

export function prepareReviewDecision(
  row: Pick<ReviewSummary, 'state' | 'eligible' | 'kind'>,
  decision: ReviewDecision,
  fields: { verified: string[]; otherPaths: string; expected: string },
  negativePaths: string[],
): { ok: true; oracle?: Record<string, unknown> } | { ok: false; error: string } {
  if (row.state !== 'ready' || !row.eligible) return { ok: false, error: 'This example is no longer available for review. Refresh the queue.' };
  if (decision === 'dismiss') return { ok: true };
  if (decision === 'training') {
    if (row.kind !== 'hard_negative_candidates') return { ok: true };
    const negatives = [...new Set(fields.verified.filter((path) => negativePaths.includes(path)))];
    if (negatives.length > 50 || negatives.some((path) => path.length > 500)) return { ok: false, error: 'Use at most 50 checked negative paths, each no longer than 500 characters.' };
    return negatives.length ? { ok: true, oracle: { verified_negatives: negatives } }
      : { ok: false, error: 'Confirm at least one incorrect result before adding it to training.' };
  }
  const paths = [...new Set([...fields.verified, ...fields.otherPaths.split(/[\n,]/).map((path) => path.trim()).filter(Boolean)])];
  const notes = fields.expected.trim();
  if (row.kind === 'retrieval' && !paths.length) return { ok: false, error: 'Choose or enter at least one independently checked source file.' };
  if (!paths.length && !notes) return { ok: false, error: 'Record the checked outcome or source evidence for this evaluation case.' };
  if (paths.length > 50 || paths.some((path) => path.length > 500)) return { ok: false, error: 'Use at most 50 source paths, each no longer than 500 characters.' };
  if (notes.length > 4000) return { ok: false, error: 'Keep the checked outcome within 4,000 characters.' };
  return { ok: true, oracle: { ...(paths.length ? { files: paths } : {}), ...(notes ? { notes } : {}) } };
}
