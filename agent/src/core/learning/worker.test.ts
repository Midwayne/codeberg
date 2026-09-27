import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DurableJobQueue } from './queue.js';
import { LearningStore } from './store.js';
import { KnowledgeWorker, parseExtractionResponse } from './worker.js';
import { exportDataset } from './export.js';
import { LearningService } from './service.js';
import { sourceRevision } from './datasets.js';

const roots: string[] = [];

async function fixtureRepository(root: string, files: Record<string, string>) {
  const path = join(root, 'source-repo');
  for (const [file, content] of Object.entries(files)) {
    const target = join(path, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return async () => [{ path, commit: 'test-commit' }];
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgeWorker', () => {
  it('initializes a shared learning service only once across model-bound chat agents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const service = new LearningService({ root, generator: { generate: async () => '{"action":"none"}' } });
    const initializeWorker = vi.spyOn(service.worker!, 'initialize');
    await Promise.all([service.initialize(), service.initialize()]);
    expect(initializeWorker).toHaveBeenCalledTimes(1);
    service.stop();
  });
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
    await service.waitForCurrent();
    service.stop();
  });
  it('recreates a missing job from durable solved feedback after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
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
    expect((await service.queue.list('completed')).map((job) => job.type).sort()).toEqual(['extract_dataset', 'extract_knowledge']);
    const events = (await readFile(join(root, 'logs', 'learning-agent.log'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line).event);
    expect(events.filter((event) => event === 'job_started')).toHaveLength(2);
    expect(events.filter((event) => event === 'job_completed')).toHaveLength(2);
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
    const repositories = await fixtureRepository(root, { 'src/FulfillmentContextBuilder.ts': 'function build() { return { fulfillmentType }; }' });
    const store = new LearningStore(root, repositories);
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
        claims: [{ statement: 'FulfillmentContextBuilder creates fulfillmentType.', evidence: [
          { repo: basename(attempt.repositories[0].path), path: 'src/FulfillmentContextBuilder.ts', quote: 'return { fulfillmentType }' },
        ] }],
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
    // Feedback is durable before the asynchronous worker can mark the file stale.
    expect((await store.knowledgeArtifacts())[0].status).toBe('active');
    expect(await store.searchKnowledge('Fulfillment Type')).toEqual([]);
    expect(await exportDataset(store, 'knowledge')).toEqual([]);
    await queue.enqueueKnowledge(attempt.interaction_id, { requeueCompleted: true });
    await worker.runUntilIdle();
    artifacts = await store.knowledgeArtifacts();
    expect(artifacts[0].status).toBe('needs_verification');
  });

  it('revisits knowledge and datasets when feedback on an older message changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const repositories = await fixtureRepository(root, { 'Consumer.ts': 'consume()', 'Producer.ts': 'produce()' });
    const generate = vi.fn(async ({ prompt }: { prompt: string; system: string }) => {
      const { interaction } = JSON.parse(prompt) as { interaction: { attempts: { answer: string; repositories: { path: string }[] }[] } };
      const answer = interaction.attempts.at(-1)?.answer ?? '';
      const consumer = answer.includes('Consumer.ts');
      return JSON.stringify({ action: 'upsert', category: 'flows', slug: 'origin', title: 'Origin',
        confidence: 'high', status: 'active', claims: [{ statement: answer, evidence: [{ repo: basename(interaction.attempts[0].repositories[0].path),
          path: consumer ? 'Consumer.ts' : 'Producer.ts', quote: consumer ? 'consume()' : 'produce()' }] }] });
    });
    const service = new LearningService({ root, repositories, generator: { generate } });
    await service.initialize();
    const first = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where does this value originate?' }] },
      { id: 'a1', role: 'assistant', parts: [
        { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't1', state: 'output-available', input: { path: 'Consumer.ts' }, output: { path: 'Consumer.ts', body: 'consume()' } },
        { type: 'text', text: 'Consumer.ts is the origin.' },
      ] },
    ] as UIMessage[];
    await service.recordSession('c', first);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].body).toContain('Consumer.ts');

    const corrected = [...first,
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'No, that is the consumer; trace the producer.' }] },
      { id: 'a2', role: 'assistant', parts: [
        { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't2', state: 'output-available', input: { path: 'Producer.ts' }, output: { path: 'Producer.ts', body: 'produce()' } },
        { type: 'text', text: 'Producer.ts is the origin.' },
      ] },
    ] as UIMessage[];
    await service.recordSession('c', corrected);
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    await service.feedback({ conversationId: 'c', messageId: 'a2', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0]).toMatchObject({ status: 'active', body: expect.stringContaining('Producer.ts is the origin.') });
    const secondCall = generate.mock.calls[1][0];
    const extractionInput = JSON.parse(secondCall.prompt);
    expect(extractionInput).toMatchObject({
      authoritative_attempt: { answer: 'Producer.ts is the origin.', evidence_used: [{ path: 'Producer.ts' }] },
      existing_artifacts: [{ slug: 'origin', status: 'needs_verification' }],
    });
    expect(extractionInput.authoritative_attempt_id).toBe(extractionInput.interaction.attempts[1].attempt_id);
    expect(extractionInput.interaction.attempts[0].answer).toContain('Consumer.ts');
    expect(secondCall.system).toContain('Earlier solved answers can be superseded');
    const before = await service.datasets.list('candidates');

    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 0, label: 'not_useful', reason: 'Consumer.ts only consumes it' });
    await service.waitForCurrent();
    const updated = (await service.store.knowledgeArtifacts())[0];
    expect(updated).toMatchObject({ status: 'active', body: expect.stringContaining('Producer.ts is the origin.') });
    expect(generate).toHaveBeenCalledTimes(3);
    const candidates = await service.datasets.list('candidates');
    expect(candidates.length).toBeGreaterThan(before.length);
    expect(candidates.some((example) => example.kind === 'hard_negatives' && example.feedback.some((feedback) => feedback.reason?.includes('Consumer.ts')))).toBe(true);
    const oldAttempt = (await service.store.attemptForMessage('c', 'a1'))!;
    expect((await service.store.currentFeedback(oldAttempt.attempt_id))?.label).toBe('not_useful');
    service.stop();

    // Simulate stopping after the feedback event was synced but before its job
    // could be enqueued; the completed job must not suppress the newer revision.
    await service.store.recordFeedback({ attemptId: oldAttempt.attempt_id, rating: 1, label: 'partially_useful' });
    const restarted = new LearningService({ root, repositories, generator: { generate } });
    await restarted.initialize();
    await restarted.waitForCurrent();
    expect(generate).toHaveBeenCalledTimes(4);
    expect((await restarted.store.knowledgeArtifacts())[0].body).toContain('Producer.ts is the origin.');
    expect((await restarted.datasets.list('candidates')).length).toBeGreaterThan(candidates.length);
    restarted.stop();
  });

  it('does not retain active knowledge when a later correction is ungraded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const repositories = await fixtureRepository(root, { 'Consumer.ts': 'consume()' });
    const service = new LearningService({ root, repositories, generator: { generate: async ({ prompt }) => JSON.stringify({
      action: 'upsert', category: 'flows', slug: 'origin', title: 'Origin', confidence: 'high', status: 'active',
      claims: [{ statement: 'Consumer.ts is the origin.', evidence: [
        { repo: basename((JSON.parse(prompt) as { interaction: { attempts: { repositories: { path: string }[] }[] } }).interaction.attempts[0].repositories[0].path), path: 'Consumer.ts', quote: 'consume()' },
      ] }],
    }) } });
    await service.initialize();
    await service.recordSession('c', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is the origin?' }] },
      { id: 'a1', role: 'assistant', parts: [
        { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't1', state: 'output-available', input: { path: 'Consumer.ts' }, output: { path: 'Consumer.ts', body: 'consume()' } },
        { type: 'text', text: 'Consumer.ts is the origin.' },
      ] },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    await service.recordSession('c', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is the origin?' }] },
      { id: 'a1', role: 'assistant', parts: [
        { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't1', state: 'output-available', input: { path: 'Consumer.ts' }, output: { path: 'Consumer.ts', body: 'consume()' } },
        { type: 'text', text: 'Consumer.ts is the origin.' },
      ] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'No, that is only a consumer.' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'I will check the producer.' }] },
    ] as UIMessage[]);
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    const interaction = await service.store.interaction((await service.store.attempts())[0].interaction_id);
    const currentRevision = sourceRevision(interaction.attempts, interaction.feedback);
    expect((await service.datasets.list('candidates')).some((row) => row.kind === 'sft' && row.source_revision === currentRevision)).toBe(false);
    service.stop();
  });
});
