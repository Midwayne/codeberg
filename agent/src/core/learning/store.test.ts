import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';

import { exportDataset } from './export.js';
import { LearningStore } from './store.js';

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
    expect(evalRows).toHaveLength(2);
    expect(embeddingRows).toEqual([]); // no cited/retrieved positive in attempt 2
  });
});
