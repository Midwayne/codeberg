import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DurableJobQueue } from './queue.js';
import { LearningStore } from './store.js';
import { KnowledgeWorker, parseExtractionResponse } from './worker.js';
import { exportDataset } from './export.js';
import { LearningService } from './service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgeWorker', () => {
  it('recovers an interrupted in-flight job when its lease expires without another restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const store = new LearningStore(root);
    await store.recordSession('conversation-1', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'src/file.ts' }] },
    ]);
    const queue = new DurableJobQueue(root, () => new Date(), 200);
    await queue.enqueueKnowledge((await store.attempts())[0].interaction_id);
    await queue.claim(); // previous process died without completing the lease
    const worker = new KnowledgeWorker(store, queue, { generate: async () => '{"action":"none"}' });
    await worker.initialize();
    await vi.waitFor(async () => expect((await queue.counts()).completed).toBe(1), { timeout: 2_000 });
    worker.stop();
  });
  it('acknowledges durable feedback even if queue handoff fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const service = new LearningService({ root });
    await service.recordSession('conversation-1', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is it?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'In src/file.ts.' }] },
    ]);
    vi.spyOn(service.queue, 'enqueueKnowledge').mockRejectedValueOnce(new Error('disk unavailable'));
    const result = await service.feedback({ conversationId: 'conversation-1', messageId: 'a1', rating: 3, label: 'solved' });
    expect(result.feedback.label).toBe('solved');
    expect((await service.store.events()).some((event) => event.type === 'feedback_recorded')).toBe(true);
  });
  it('recreates a missing job from durable solved feedback after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const service = new LearningService({ root, generator: { generate: async () => '{"action":"none"}' } });
    await service.recordSession('conversation-1', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is it?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'In src/file.ts.' }] },
    ]);
    const attempt = (await service.store.attempts())[0];
    await service.store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    expect((await service.queue.counts()).pending).toBe(0);
    await service.initialize();
    await service.waitForCurrent();
    expect((await service.queue.counts()).completed).toBe(1);
    service.stop();
  });
  it('accepts a JSON object wrapped in model commentary', () => {
    expect(
      parseExtractionResponse(
        'Here is the requested JSON:\n{"action":"none"}\nThis contains no durable knowledge.',
      ),
    ).toEqual({ action: 'none' });
  });

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
    expect(await exportDataset(store, 'knowledge')).toMatchObject([{
      schema_version: 1, record_type: 'knowledge_artifact',
      category: 'flows', status: 'active', source_interactions: [attempt.interaction_id],
    }]);

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
