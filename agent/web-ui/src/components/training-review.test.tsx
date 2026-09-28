import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewDetail, TrainingSummary } from './training-review';
import type { ReviewExample, ReviewSummary } from '@/lib/training';

describe('training review', () => {
  it('makes review progress and destinations understandable at a glance', () => {
    const html = renderToStaticMarkup(<TrainingSummary stats={{
      total: 12, ready: 4, training: 3, eval: 2, dismissed: 1, stale: 2,
      by_kind: { retrieval: 3, sft: 1 },
    }} />);
    expect(html).toContain('6 of 10 current examples reviewed');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('2 outdated revisions excluded');
    expect(html).toContain('3 search evidence');
    expect(html).toContain('Held-out checks');
  });

  it('shows the candidate question, answer, evidence, feedback, and explicit evaluation review', () => {
    const row: ReviewSummary = {
      id: 'example-123', kind: 'retrieval', query: 'Where is the calculation?', extracted_at: '2026-09-28T10:00:00Z',
      state: 'ready', eligible: true, feedback: { label: 'solved' }, repositories: ['core'],
      answer_preview: 'The calculation is in src/Flow.ts', proposed_files: ['src/Flow.ts'],
    };
    const example: ReviewExample = {
      id: row.id, kind: row.kind, query: row.query, feedback: [{ label: 'solved' }], repositories: [{ name: 'core' }],
      provenance: 'answer_referenced', confidence: 'unverified',
      payload: { trajectory: [{ answer: 'The calculation is in src/Flow.ts' }],
        proposed_evidence: [{ path: 'src/Flow.ts', snippet: 'return picked + packed' }] },
    };
    const html = renderToStaticMarkup(<ReviewDetail row={row} example={example} destination="eval"
      onDestination={() => undefined} verified={[]} onVerified={() => undefined} otherPaths="" onOtherPaths={() => undefined}
      expected="" onExpected={() => undefined} saving={false} onDecide={() => undefined} onNext={() => undefined} />);
    expect(html).toContain('Where is the calculation?');
    expect(html).toContain('The calculation is in src/Flow.ts');
    expect(html).toContain('return picked + packed');
    expect(html).toContain('User feedback: solved');
    expect(html).toContain('Which sources did you independently verify?');
    expect(html).toContain('Save evaluation case');
    expect(html).toContain('Set aside');
  });
});
