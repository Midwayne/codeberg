import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';

import { exportDataset } from './export.js';
import { DatasetStore } from './datasets.js';
import { writeAtomic } from './fs.js';
import { LearningStore, serializeArtifact } from './store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<LearningStore> {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-learning-'));
  roots.push(root);
  return new LearningStore(root);
}

function transcript(answerId = 'a1'): UIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is fulfillmentType produced?' }] },
    {
      id: answerId,
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-1',
          toolName: 'search_code',
          state: 'output-available',
          input: { query: 'fulfillmentType producer', token: 'secret-value' },
          output: [
            {
              path: 'src/FulfillmentContextBuilder.ts',
              symbol: 'FulfillmentContextBuilder.build',
              score: 0.92,
              snippet: 'return { fulfillmentType }',
            },
            { path: 'src/FooService.ts', symbol: 'FooService.map', score: 0.8 },
          ],
        } as UIMessage['parts'][number],
        {
          type: 'text',
          text: 'It originates in FulfillmentContextBuilder.build [src/FulfillmentContextBuilder.ts:10-20].',
        },
      ],
    },
  ];
}

describe('LearningStore', () => {
  it('keeps pre-versioned knowledge readable for explicit historical inspection', async () => {
    const learning = await store();
    const legacy = {
      id: 'knowledge-legacy', title: 'Legacy shipping flow', category: 'flows' as const,
      slug: 'legacy-shipping-flow', created_at: '2025-01-01', updated_at: '2025-01-01',
      last_verified_at: '2025-01-01', repositories: ['old-repo'],
      source_interactions: ['interaction-legacy'], source_commits: {},
      confidence: 'high' as const, status: 'active' as const, body: 'Historical shipping process.',
    };
    await writeAtomic(join(learning.root, 'knowledge', 'flows', 'legacy-shipping-flow.md'), serializeArtifact(legacy));
    expect((await learning.knowledgeArtifacts())[0]).toMatchObject(legacy);
    expect(await learning.searchKnowledge('shipping')).toEqual([]);
    expect(await learning.searchKnowledge('shipping', 10, { includeUnverified: true })).toMatchObject([
      { artifact: { id: 'knowledge-legacy', body: 'Historical shipping process.' } },
    ]);
  });

  it('ranks a rare relevant concept over repetition of common terms in any query order', async () => {
    const learning = await store();
    const artifact = {
      category: 'flows' as const, created_at: '2026-09-26', updated_at: '2026-09-26',
      last_verified_at: '2026-09-26', repositories: ['core'], source_interactions: ['interaction-old'],
      source_commits: {}, confidence: 'medium' as const, status: 'needs_verification' as const,
    };
    await writeAtomic(join(learning.root, 'knowledge', 'flows', 'mpm-units.md'), serializeArtifact({
      ...artifact, id: 'mpm', title: 'MPM remaining available units', slug: 'mpm-units',
      body: 'Subtract store-close from the open total.',
    }));
    await writeAtomic(join(learning.root, 'knowledge', 'flows', 'unrelated-units.md'), serializeArtifact({
      ...artifact, id: 'unrelated', title: 'Units availability', slug: 'unrelated-units',
      body: `${'remaining '.repeat(5)}${'available '.repeat(5)}${'units '.repeat(5)}`,
    }));

    const hits = await learning.searchKnowledge('units available remaining MPM', 10, { includeUnverified: true });
    expect(hits.map((hit) => hit.artifact.id)).toEqual(['mpm', 'unrelated']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('durably records a deduplicated attempt with retrieval separate from used evidence', async () => {
    const learning = await store();
    await learning.recordSession('conversation-1', transcript());
    await learning.recordSession('conversation-1', transcript());

    const attempts = await learning.attempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].search_queries).toEqual(['fulfillmentType producer']);
    expect(attempts[0].retrieved_results).toHaveLength(2);
    expect(attempts[0].evidence_used).toHaveLength(1);
    expect(attempts[0].evidence_used[0].path).toBe('src/FulfillmentContextBuilder.ts');
    const raw = await readFile(
      join(learning.root, 'events', `${new Date().toISOString().slice(0, 10)}.jsonl`),
      'utf8',
    );
    expect(raw).not.toContain('secret-value');
  });

  it('appends superseding feedback without losing history', async () => {
    const learning = await store();
    await learning.recordSession('conversation-1', transcript());
    const attempt = (await learning.attempts())[0];
    const solved = await learning.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 3,
      label: 'solved',
    });
    const corrected = await learning.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 1,
      label: 'partially_useful',
      reason: 'scheduled orders differ',
    });

    const events = await learning.events();
    expect(events.filter((event) => event.type === 'feedback_recorded')).toHaveLength(2);
    expect(corrected.supersedes_feedback_id).toBe(solved.feedback_id);
    expect((await learning.currentFeedback(attempt.attempt_id))?.label).toBe('partially_useful');
  });

  it('preserves a regenerated answer when the client reuses its message id', async () => {
    const learning = await store();
    await learning.recordSession('conversation-1', transcript('a1'));
    const regenerated = transcript('a1');
    regenerated[1] = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'A different answer after regeneration.' }],
    };
    await learning.recordSession('conversation-1', regenerated);
    const attempts = await learning.attempts();
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((attempt) => attempt.attempt_id)).size).toBe(2);
    expect((await learning.attemptForMessage('conversation-1', 'a1'))?.answer).toBe(
      'A different answer after regeneration.',
    );
  });

  it('quarantines a partial JSONL tail before the next durable event', async () => {
    const learning = await store();
    await learning.recordSession('conversation-1', transcript());
    const path = join(learning.root, 'events', `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await appendFile(path, '{"interrupted":', 'utf8');
    const attempt = (await learning.attempts())[0];
    await learning.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 3,
      label: 'solved',
    });
    expect((await learning.currentFeedback(attempt.attempt_id))?.label).toBe('solved');
  });

  it('keeps a correction in the same interaction and exports conservative labels', async () => {
    const learning = await store();
    await learning.recordSession('conversation-1', transcript('a1'));
    const first = (await learning.attempts())[0];
    await learning.recordFeedback({
      attemptId: first.attempt_id,
      rating: 0,
      label: 'not_useful',
    });
    const messages = [
      ...transcript('a1'),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Actually, that only maps it.' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'The builder produces it.' }] },
    ] as UIMessage[];
    await learning.recordSession('conversation-1', messages);
    const attempts = await learning.attempts();
    expect(attempts).toHaveLength(2);
    expect(attempts[1].interaction_id).toBe(attempts[0].interaction_id);
    await learning.recordFeedback({
      attemptId: attempts[1].attempt_id,
      rating: 3,
      label: 'solved',
    });

    const evalRows = await exportDataset(learning, 'eval');
    const embeddingRows = await exportDataset(learning, 'embedding');
    expect(evalRows).toHaveLength(0); // unreviewed answers cannot enter held-out eval
    expect(embeddingRows).toEqual([]); // no cited/retrieved positive in attempt 2
    const chatRows = await exportDataset(learning, 'openai-chat');
    expect(chatRows).toEqual([]); // correction without context is not a standalone training sample
  });

  it('exports a standalone solved response in chat training format', async () => {
    const learning = await store();
    await learning.recordSession('standalone', transcript());
    const attempt = (await learning.attempts())[0];
    await learning.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    const datasets = new DatasetStore(learning);
    const candidates = await datasets.extract(attempt.interaction_id);
    await datasets.promote(candidates.find((row) => row.kind === 'sft')!.id, 'training', { provenance: 'user_confirmed' });
    await datasets.promote(candidates.find((row) => row.kind === 'retrieval')!.id, 'training', { provenance: 'user_confirmed' });
    const rows = await exportDataset(learning, 'openai-chat');
    expect(rows).toEqual([{ messages: [
      { role: 'user', content: attempt.user_query },
      { role: 'assistant', content: attempt.answer },
    ] }]);
    expect(await exportDataset(learning, 'query-positive-negative')).toEqual([{
      query: attempt.user_query,
      positive: ['src/FulfillmentContextBuilder.ts\nFulfillmentContextBuilder.build\nreturn { fulfillmentType }'],
      negative: [], // an uncited hit with no source text is not a trainable negative
    }]);
    expect(await exportDataset(learning, 'eval')).toEqual([]);
    await learning.recordFeedback({ attemptId: attempt.attempt_id, rating: 0, label: 'not_useful' });
    expect(await datasets.active('training')).toEqual([]);
    expect(await datasets.list('training')).toHaveLength(2); // immutable audit history
    expect(await exportDataset(learning, 'openai-chat')).toEqual([]); // reviewed revision is now stale
  });
});
