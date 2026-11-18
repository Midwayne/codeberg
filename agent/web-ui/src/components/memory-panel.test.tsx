import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { MemoryView } from './memory-panel';

it('explains how memory fills up when nothing is saved yet', () => {
  const html = renderToStaticMarkup(
    <MemoryView dashboard={{ profile: [], knowledge: [], pending: 0, errors: [] }} busy={false} onRemove={() => undefined} />,
  );

  expect(html).toContain('How you work');
  expect(html).toContain('keep answers short');
  expect(html).toContain('Mostly correct');
});

it('lists profile notes with a remove action, knowledge, and pending or failed saves', () => {
  const html = renderToStaticMarkup(
    <MemoryView
      dashboard={{
        profile: [
          {
            id: 'profile-1',
            kind: 'preference',
            statement: 'Prefers tables.',
            evidence: 'use a table',
            source_interactions: ['i1'],
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ],
        knowledge: [
          { id: 'k1', title: 'Checkout flow', category: 'flows', status: 'active', confidence: 'medium', updated_at: '2026-01-01', uses: 3, last_used_at: '2026-02-01T00:00:00Z' },
          { id: 'confirmed-1', title: 'Refund rules', category: 'concepts', status: 'active', confidence: 'low', updated_at: '2026-01-01', uses: 0 },
        ],
        pending: 2,
        errors: [{ type: 'extract_profile', status: 'pending', error: 'MODEL_ERROR: offline' }],
      }}
      busy={false}
      onRemove={() => undefined}
    />,
  );

  expect(html).toContain('Prefers tables.');
  expect(html).toContain('aria-label="Remove note: Prefers tables."');
  expect(html).toContain('Checkout flow');
  expect(html).toContain('confirmed answer, not source-verified');
  expect(html).toContain('used 3 times');
  expect(html).toContain('not used yet');
  expect(html).toContain('Saving from 2 recent answers');
  expect(html).toContain('Learning how you work will retry: MODEL_ERROR: offline');
});
