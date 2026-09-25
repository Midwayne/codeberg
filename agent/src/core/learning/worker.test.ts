import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DurableJobQueue } from './queue.js';
import { LearningStore } from './store.js';
import { KnowledgeWorker } from './worker.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgeWorker', () => {
  it('creates one provenance-backed artifact and invalidates it after feedback is downgraded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const store = new LearningStore(root);
    const queue = new DurableJobQueue(root);
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Who creates fulfillmentType?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'tool-1',
            toolName: 'read_file',
            state: 'output-available',
            input: { path: 'src/FulfillmentContextBuilder.ts' },
            output: {
              path: 'src/FulfillmentContextBuilder.ts',
              symbol: 'FulfillmentContextBuilder.build',
              body: 'return { fulfillmentType }',
            },
          } as UIMessage['parts'][number],
          {
            type: 'text',
            text: 'FulfillmentContextBuilder creates it [src/FulfillmentContextBuilder.ts:10-20].',
          },
        ],
      },
    ] as UIMessage[];
    await store.recordSession('conversation-1', messages);
    const attempt = (await store.attempts())[0];
    const solved = await store.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 3,
      label: 'solved',
    });
    const generate = vi.fn(async () =>
      JSON.stringify({
        action: 'upsert',
        category: 'flows',
        slug: 'fulfillment-type-lifecycle',
        title: 'Fulfillment Type Lifecycle',
        confidence: 'high',
        status: 'active',
        body: 'FulfillmentContextBuilder creates fulfillmentType.',
      }),
    );
    const worker = new KnowledgeWorker(store, queue, { generate });
    await queue.enqueueKnowledge(attempt.interaction_id);
    await worker.runUntilIdle();

    let artifacts = await store.knowledgeArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].source_interactions).toEqual([attempt.interaction_id]);
    expect(artifacts[0].status).toBe('active');

    await queue.enqueueKnowledge(attempt.interaction_id, { requeueCompleted: true });
    await worker.runUntilIdle();
    expect(generate).toHaveBeenCalledTimes(1);

    await store.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 1,
      label: 'partially_useful',
      supersedesFeedbackId: solved.feedback_id,
    });
    await queue.enqueueKnowledge(attempt.interaction_id, { requeueCompleted: true });
    await worker.runUntilIdle();
    artifacts = await store.knowledgeArtifacts();
    expect(artifacts[0].status).toBe('needs_verification');
  });
});
