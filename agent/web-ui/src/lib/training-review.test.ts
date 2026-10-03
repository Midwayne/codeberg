import { describe, expect, it } from 'vitest';
import type { ReviewDashboard, ReviewSummary } from './training';
import { applyReviewDecision, prepareReviewDecision, reviewSelection } from './training-review';

const rows: ReviewSummary[] = ['ready', 'training', 'stale'].map((state, index) => ({
  id: String(index), kind: 'retrieval', state: state as ReviewSummary['state'], eligible: state !== 'stale',
  query: 'A question', extracted_at: '', repositories: [], answer_preview: '', proposed_files: [],
}));

describe('review selection', () => {
  it('preserves a selection only within the active filter, including refreshes', () => {
    expect(reviewSelection(rows, 'reviewed', '1')).toBe('1');
    expect(reviewSelection(rows, 'reviewed', '0')).toBe('1');
    expect(reviewSelection(rows, 'stale', '0')).toBe('2');
    expect(reviewSelection([], 'ready', '0')).toBeUndefined();
  });

  it('records a confirmed save before refreshing, removing the item from the ready queue', () => {
    const dashboard: ReviewDashboard = { candidates: rows, stats: {total:3,ready:1,training:1,eval:0,dismissed:0,stale:1,by_kind:{retrieval:1}} };
    const updated = applyReviewDecision(dashboard, '0', 'eval');
    expect(updated.candidates[0]?.state).toBe('eval');
    expect(updated.stats).toMatchObject({ready:0,eval:1,training:1,stale:1,by_kind:{}});
    expect(reviewSelection(updated.candidates, 'ready', '0')).toBeUndefined();
    expect(dashboard.candidates[0]?.state).toBe('ready');
  });
});

describe('review decision evidence', () => {
  const fields = { verified: [] as string[], otherPaths: '', expected: '' };
  it('requires independently checked files for retrieval evaluation and deduplicates paths', () => {
    expect(prepareReviewDecision(rows[0]!, 'eval', fields, [])).toMatchObject({ok:false});
    expect(prepareReviewDecision(rows[0]!, 'eval', {...fields,verified:['src/a.ts'],otherPaths:'src/a.ts, src/b.ts'}, [])).toEqual({ok:true,oracle:{files:['src/a.ts','src/b.ts']}});
  });
  it('does not treat other evaluation paths as verified negative training evidence', () => {
    const negative = {...rows[0]!,kind:'hard_negative_candidates' as const};
    expect(prepareReviewDecision(negative, 'training', {...fields,otherPaths:'src/wrong.ts'}, ['src/wrong.ts'])).toMatchObject({ok:false});
    expect(prepareReviewDecision(negative, 'training', {...fields,verified:['src/unoffered.ts']}, ['src/wrong.ts'])).toMatchObject({ok:false});
    expect(prepareReviewDecision(negative, 'training', {...fields,verified:['src/wrong.ts']}, ['src/wrong.ts'])).toEqual({ok:true,oracle:{verified_negatives:['src/wrong.ts']}});
  });
  it('accepts notes for non-retrieval evaluation and refuses outdated decisions', () => {
    expect(prepareReviewDecision({...rows[0]!,kind:'sft'}, 'eval', {...fields,expected:'Checked outcome'}, [])).toEqual({ok:true,oracle:{notes:'Checked outcome'}});
    expect(prepareReviewDecision(rows[2]!, 'training', fields, [])).toMatchObject({ok:false});
    expect(prepareReviewDecision(rows[1]!, 'dismiss', fields, [])).toMatchObject({ok:false});
  });
  it('keeps checked evidence within the API limits for both destinations', () => {
    const paths = Array.from({length:51}, (_, index) => `src/${index}.ts`);
    const negative = {...rows[0]!,kind:'hard_negative_candidates' as const};
    expect(prepareReviewDecision(negative, 'training', {...fields,verified:paths}, paths)).toMatchObject({ok:false});
    expect(prepareReviewDecision(rows[0]!, 'eval', {...fields,verified:paths}, [])).toMatchObject({ok:false});
    expect(prepareReviewDecision(rows[0]!, 'eval', {...fields,otherPaths:'a'.repeat(501)}, [])).toMatchObject({ok:false});
  });
});
