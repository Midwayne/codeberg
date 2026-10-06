import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sourceRevision } from './datasets.js';
import { exportDataset } from './export.js';
import { writeAtomic } from './fs.js';
import { DurableJobQueue } from './queue.js';
import { LearningService } from './service.js';
import { LearningStore, serializeArtifact, stableId } from './store.js';
import { KnowledgeWorker, parseExtractionResponse } from './worker.js';

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
  it('does not start jobs before startup reconciliation has completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-start-'));
    roots.push(root);
    const service = new LearningService({
      root,
      generator: { generate: async () => '{"action":"none"}' },
    });

    const claim = vi.spyOn(service.queue, 'claim');
    await service.recordSession('startup', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Where?' }] },
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Here.' }] },
    ]);
    expect(claim).not.toHaveBeenCalled();
    await service.initialize();
    await service.waitForCurrent();
    expect(claim).toHaveBeenCalled();
    service.stop();
  });

  it('initializes a shared learning service only once across model-bound chat agents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const service = new LearningService({
      root,
      generator: { generate: async () => '{"action":"none"}' },
    });

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
    await vi.waitFor(async () => expect((await queue.counts()).completed).toBe(1), {
      timeout: 2_000,
    });
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
    vi.spyOn(service.queue, 'enqueueKnowledge').mockRejectedValueOnce(
      new Error('disk unavailable'),
    );
    const result = await service.feedback({
      conversationId: 'conversation-1',
      messageId: 'a1',
      rating: 3,
      label: 'solved',
    });

    expect(result.feedback.label).toBe('solved');
    expect((await service.store.events()).some((event) => event.type === 'feedback_recorded')).toBe(
      true,
    );
    await service.waitForCurrent();
    service.stop();
  });

  it('adds a solved correction without citations to a matching old document as a provisional user note', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
    const repositories = await fixtureRepository(root, {
      'src/Store.ts': 'export const totalOpenUnits = 59;',
    });
    const service = new LearningService({
      root: join(root, 'learning'),
      repositories,
      generator: {
        generate: vi.fn(
          async () => '{"action":"none","reason":"No quoted source proves the formula."}',
        ),
      },
    });

    await service.initialize();
    const path = join(service.store.root, 'knowledge', 'flows', 'remaining-available-units.md');
    await writeAtomic(
      path,
      serializeArtifact({
        id: 'knowledge-units',
        title: 'Remaining available units',
        category: 'flows',
        slug: 'remaining-available-units',
        created_at: '2026-09-25',
        updated_at: '2026-09-25',
        last_verified_at: '2026-09-25',
        repositories: ['source-repo'],
        source_interactions: ['interaction-older'],
        source_commits: {},
        confidence: 'medium',
        status: 'needs_verification',
        body: '## Definition\nOlder explanation.',
      }),
    );
    await service.recordSession('c', [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'I meant remaining available units = total open units - store-close open units.',
          },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Understood: subtract store-close from total.' }],
      },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();

    const artifact = (await service.store.knowledgeArtifacts())[0];
    expect(artifact.body).toContain('User-confirmed notes (not source-verified)');
    expect(artifact.body).toContain(
      'remaining available units = total open units - store-close open units',
    );
    expect(artifact.status).toBe('needs_verification');
    expect(artifact.user_confirmed_notes).toHaveLength(1);
    expect(await readFile(join(root, 'logs', 'learning-agent-trace.log'), 'utf8')).toContain(
      'user_note_added',
    );
    await service.queue.enqueueKnowledge((await service.store.attempts())[0].interaction_id, {
      requeueCompleted: true,
    });
    service.worker!.wake();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].user_confirmed_notes).toHaveLength(1);
    service.stop();
  });

  it('rechecks earlier cited files but keeps a source-unproven correction provisional', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
    const repositories = await fixtureRepository(root, {
      'src/Store.ts': 'export const totalOpenUnits = 59;',
    });
    const generate = vi.fn(
      async () => '{"action":"none","reason":"No code states the consumer subtraction."}',
    );
    const service = new LearningService({
      root: join(root, 'learning'),
      repositories,
      generator: { generate },
    });

    await service.initialize();
    const path = join(service.store.root, 'knowledge', 'flows', 'remaining-available-units.md');
    await writeAtomic(
      path,
      serializeArtifact({
        id: 'knowledge-units',
        title: 'Remaining available units',
        category: 'flows',
        slug: 'remaining-available-units',
        created_at: '2026-09-25',
        updated_at: '2026-09-25',
        last_verified_at: '2026-09-25',
        repositories: ['source-repo'],
        source_interactions: ['interaction-older'],
        source_commits: {},
        confidence: 'medium',
        status: 'needs_verification',
        body: 'Older explanation.',
      }),
    );
    await service.recordSession('c', [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'What is the total open units count?' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'src/Store.ts' },
            output: { path: 'src/Store.ts', body: 'totalOpenUnits = 59' },
          },
          { type: 'text', text: 'src/Store.ts reports totalOpenUnits.' },
        ],
      },
      {
        id: 'u2',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'I meant remaining available units = total open units - store-close open units.',
          },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Subtract store-close from total open units.' }],
      },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a2', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect(generate).toHaveBeenCalledOnce();
    expect((await service.store.knowledgeArtifacts())[0].body).toContain(
      'User-confirmed notes (not source-verified)',
    );
    const trace = (await readFile(join(root, 'logs', 'learning-agent-trace.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(trace).toContainEqual(
      expect.objectContaining({
        event: 'model_response',
        raw: '{"action":"none","reason":"No code states the consumer subtraction."}',
      }),
    );
    expect(trace).toContainEqual(
      expect.objectContaining({
        event: 'extraction_skipped',
        reason: 'model_returned_none',
        model_reason: 'No code states the consumer subtraction.',
      }),
    );
    service.stop();
  });

  it('replays old completed extraction jobs once after the knowledge policy changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const store = new LearningStore(root);
    const queue = new DurableJobQueue(root);
    await writeAtomic(
      join(root, 'knowledge', 'flows', 'remaining-available-units.md'),
      serializeArtifact({
        id: 'knowledge-units',
        title: 'Remaining available units',
        category: 'flows',
        slug: 'remaining-available-units',
        created_at: '2026-09-25',
        updated_at: '2026-09-25',
        last_verified_at: '2026-09-25',
        repositories: ['source-repo'],
        source_interactions: ['interaction-older'],
        source_commits: {},
        confidence: 'medium',
        status: 'needs_verification',
        body: 'Older explanation.',
      }),
    );
    await store.recordSession('c', [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'I meant remaining available units = total open units - store-close open units.',
          },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Subtract store-close from total open units.' }],
      },
    ] as UIMessage[]);
    const attempt = (await store.attempts())[0];
    await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    await queue.enqueueKnowledge(attempt.interaction_id);
    const claimed = (await queue.claim())!;
    const interaction = await store.interaction(attempt.interaction_id);
    claimed.source_revision = sourceRevision(interaction.attempts, interaction.feedback);
    claimed.extraction_version = 2;
    await queue.complete(claimed); // Old worker completed without updating the document.

    const service = new LearningService({
      root,
      generator: { generate: async () => '{"action":"none"}' },
    });

    await service.initialize();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].user_confirmed_notes).toHaveLength(1);
    expect(
      (await service.queue.get(stableId('job', 'extract_knowledge', attempt.interaction_id)))
        ?.extraction_version,
    ).toBe(3);
    service.stop();
  });

  it('finds a stale document from another interaction and records the extraction decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
    const repositories = await fixtureRepository(root, {
      'src/Store.ts': 'export function remainingUnits() { return totalOpen - storeClose; }',
      'src/Old.ts': 'export const totalOpen = picked + packed;',
    });

    const generate = vi.fn(async (_input: { prompt: string }) =>
      JSON.stringify({
        action: 'upsert',
        category: 'flows',
        slug: 'remaining-available-units',
        title: 'Remaining available units',
        status: 'active',
        confidence: 'high',
        reason: 'Current sources confirm the old total and new subtraction.',
        claims: [
          {
            statement: 'Remaining units subtract storeClose from totalOpen.',
            evidence: [
              {
                repo: 'source-repo',
                path: 'src/Store.ts',
                quote: 'return totalOpen - storeClose;',
              },
            ],
          },
          {
            statement: 'The total is picked plus packed.',
            evidence: [
              { repo: 'source-repo', path: 'src/Old.ts', quote: 'totalOpen = picked + packed;' },
            ],
          },
        ],
      }),
    );

    const service = new LearningService({
      root: join(root, 'learning'),
      repositories,
      generator: { generate },
    });

    await service.initialize();
    const path = join(service.store.root, 'knowledge', 'flows', 'remaining-available-units.md');
    await writeAtomic(
      path,
      serializeArtifact({
        id: 'knowledge-units',
        title: 'Remaining available units',
        category: 'flows',
        slug: 'remaining-available-units',
        created_at: '2026-09-25',
        updated_at: '2026-09-25',
        last_verified_at: '2026-09-25',
        repositories: ['source-repo'],
        source_interactions: ['interaction-older'],
        source_commits: {},
        source_refs: [{ repo: join(root, 'source-repo'), path: 'src/Old.ts' }],
        confidence: 'medium',
        status: 'needs_verification',
        body: 'Older explanation.',
        user_confirmed_notes: [
          {
            interaction_id: 'interaction-confirmed',
            source_revision: 'old-revision',
            text: 'Earlier user-confirmed exception.',
            confirmed_at: '2026-09-25',
            provenance: 'user_confirmed',
          },
        ],
      }),
    );
    await service.recordSession('c', [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'How are remaining available units calculated?' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'src/Store.ts' },
            output: { path: 'src/Store.ts', body: 'return totalOpen - storeClose;' },
          },
          { type: 'text', text: 'src/Store.ts subtracts storeClose from totalOpen.' },
        ],
      },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();

    expect(generate).toHaveBeenCalledOnce();
    expect(JSON.parse(generate.mock.calls[0][0].prompt).existing_artifacts).toMatchObject([
      { id: 'knowledge-units', status: 'needs_verification' },
    ]);
    expect(JSON.parse(generate.mock.calls[0][0].prompt).current_source_observations).toMatchObject([
      expect.objectContaining({ path: 'src/Old.ts' }),
      expect.objectContaining({ path: 'src/Store.ts' }),
    ]);
    expect((await service.store.knowledgeArtifacts())[0]).toMatchObject({
      id: 'knowledge-units',
      status: 'active',
      body: expect.stringContaining('totalOpen - storeClose'),
      user_confirmed_notes: [{ text: 'Earlier user-confirmed exception.' }],
    });
    expect((await service.store.knowledgeArtifacts())[0].body).toContain(
      'User-confirmed notes (not source-verified)',
    );
    expect((await service.store.knowledgeArtifacts())[0].body).toContain('picked plus packed');
    expect(
      (await service.store.currentKnowledgeArtifacts()).map((artifact) => artifact.id),
    ).toContain('knowledge-units');
    expect((await service.store.currentKnowledgeArtifacts())[0].body).not.toContain(
      'Earlier user-confirmed exception.',
    );
    expect((await service.store.knowledgeArtifacts())[0].historical_source_interactions).toContain(
      'interaction-older',
    );
    const trace = (await readFile(join(root, 'logs', 'learning-agent-trace.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(trace.map((entry) => entry.event)).toContain('model_response');
    expect(trace).toContainEqual(
      expect.objectContaining({ event: 'artifact_upserted', slug: 'remaining-available-units' }),
    );
    service.stop();
  });

  it('grounds an exact quote past the model excerpt in the current source file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
    const quote = 'return todaysWorkCappedByTMU + priorityUnits';
    const repositories = await fixtureRepository(root, {
      'src/Progress.ts': `${'// earlier progress calculations\n'.repeat(500)}${quote}\n`,
    });
    const service = new LearningService({
      root: join(root, 'learning'),
      repositories,
      generator: {
        generate: async ({ prompt }) => {
          const input = JSON.parse(prompt) as {
            current_source_observations: { excerpt: string }[];
          };
          expect(input.current_source_observations[0].excerpt).not.toContain(quote);

          return JSON.stringify({
            action: 'upsert',
            category: 'flows',
            slug: 'progress-work',
            title: 'Progress work',
            status: 'active',
            confidence: 'high',
            claims: [
              {
                statement: 'Available progress work includes priority units.',
                evidence: [{ repo: 'source-repo', path: 'src/Progress.ts', quote }],
              },
              {
                statement: 'Unsupported extra detail must be dropped.',
                evidence: [
                  {
                    repo: 'source-repo',
                    path: 'src/Progress.ts',
                    quote: 'return invented calculation',
                  },
                ],
              },
            ],
          });
        },
      },
    });

    await service.initialize();
    await service.recordSession('c', [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'How are priority units added to progress work?' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'src/Progress.ts' },
            output: { path: 'src/Progress.ts', body: quote },
          },
          { type: 'text', text: 'src/Progress.ts adds priority units to capped work.' },
        ],
      },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.store.currentKnowledgeArtifacts())[0]?.body).toContain(quote);
    expect((await service.store.currentKnowledgeArtifacts())[0]?.body).not.toContain(
      'invented calculation',
    );
    const trace = (await readFile(join(root, 'logs', 'learning-agent-trace.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(trace).toContainEqual(
      expect.objectContaining({ event: 'claims_rejected', rejected_indexes: [1] }),
    );
    service.stop();
  });
  it('recreates a missing job from durable solved feedback after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    vi.stubEnv('CODEBERG_LOG_DIR', join(root, 'logs'));
    const service = new LearningService({
      root,
      generator: { generate: async () => '{"action":"none"}' },
    });

    await service.recordSession('conversation-1', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is it?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'In src/file.ts.' }] },
    ]);
    const attempt = (await service.store.attempts())[0];
    await service.store.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: 3,
      label: 'solved',
    });
    expect((await service.queue.counts()).pending).toBe(0);
    await service.initialize();
    await service.waitForCurrent();
    expect((await service.queue.list('completed')).map((job) => job.type).sort()).toEqual([
      'extract_dataset',
      'extract_knowledge',
    ]);
    const events = (await readFile(join(root, 'logs', 'learning-agent.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event);

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
    const repositories = await fixtureRepository(root, {
      'src/FulfillmentContextBuilder.ts': 'function build() { return { fulfillmentType }; }',
    });
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
        claims: [
          {
            statement: 'FulfillmentContextBuilder creates fulfillmentType.',
            evidence: [
              {
                repo: basename(attempt.repositories[0].path),
                path: 'src/FulfillmentContextBuilder.ts',
                quote: 'return { fulfillmentType }',
              },
            ],
          },
        ],
      }),
    );

    const worker = new KnowledgeWorker(store, queue, { generate });
    await queue.enqueueKnowledge(attempt.interaction_id);
    await worker.runUntilIdle();

    let artifacts = await store.knowledgeArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].source_interactions).toEqual([attempt.interaction_id]);
    expect(artifacts[0].status).toBe('active');
    expect(await exportDataset(store, 'knowledge')).toMatchObject([
      {
        schema_version: 1,
        record_type: 'knowledge_artifact',
        category: 'flows',
        status: 'active',
        source_interactions: [attempt.interaction_id],
      },
    ]);

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
    const repositories = await fixtureRepository(root, {
      'Consumer.ts': 'consume()',
      'Producer.ts': 'produce()',
    });

    const generate = vi.fn(async ({ prompt }: { prompt: string; system: string }) => {
      const { interaction } = JSON.parse(prompt) as {
        interaction: { attempts: { answer: string; repositories: { path: string }[] }[] };
      };
      const answer = interaction.attempts.at(-1)?.answer ?? '';
      const consumer = answer.includes('Consumer.ts');

      return JSON.stringify({
        action: 'upsert',
        category: 'flows',
        slug: 'origin',
        title: 'Origin',
        confidence: 'high',
        status: 'active',
        claims: [
          {
            statement: answer,
            evidence: [
              {
                repo: basename(interaction.attempts[0].repositories[0].path),
                path: consumer ? 'Consumer.ts' : 'Producer.ts',
                quote: consumer ? 'consume()' : 'produce()',
              },
            ],
          },
        ],
      });
    });

    const service = new LearningService({ root, repositories, generator: { generate } });
    await service.initialize();
    const first = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Where does this value originate?' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'Consumer.ts' },
            output: { path: 'Consumer.ts', body: 'consume()' },
          },
          { type: 'text', text: 'Consumer.ts is the origin.' },
        ],
      },
    ] as UIMessage[];

    await service.recordSession('c', first);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].body).toContain('Consumer.ts');

    const corrected = [
      ...first,
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'No, that is the consumer; trace the producer.' }],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't2',
            state: 'output-available',
            input: { path: 'Producer.ts' },
            output: { path: 'Producer.ts', body: 'produce()' },
          },
          { type: 'text', text: 'Producer.ts is the origin.' },
        ],
      },
    ] as UIMessage[];

    await service.recordSession('c', corrected);
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    await service.feedback({ conversationId: 'c', messageId: 'a2', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0]).toMatchObject({
      status: 'active',
      body: expect.stringContaining('Producer.ts is the origin.'),
    });
    const secondCall = generate.mock.calls[1][0];
    const extractionInput = JSON.parse(secondCall.prompt);
    expect(extractionInput).toMatchObject({
      authoritative_attempt: {
        answer: 'Producer.ts is the origin.',
        evidence_used: [{ path: 'Producer.ts' }],
      },
      existing_artifacts: [{ slug: 'origin', status: 'needs_verification' }],
    });
    expect(extractionInput.authoritative_attempt_id).toBe(
      extractionInput.interaction.attempts[1].attempt_id,
    );
    expect(extractionInput.interaction.attempts[0].answer).toContain('Consumer.ts');
    expect(secondCall.system).toContain('Earlier solved answers can be superseded');
    const before = await service.datasets.list('candidates');

    await service.feedback({
      conversationId: 'c',
      messageId: 'a1',
      rating: 0,
      label: 'not_useful',
      reason: 'Consumer.ts only consumes it',
    });
    await service.waitForCurrent();
    const updated = (await service.store.knowledgeArtifacts())[0];
    expect(updated).toMatchObject({
      status: 'active',
      body: expect.stringContaining('Producer.ts is the origin.'),
    });
    expect(generate).toHaveBeenCalledTimes(3);
    const candidates = await service.datasets.list('candidates');
    expect(candidates.length).toBeGreaterThan(before.length);
    expect(
      candidates.some(
        (example) =>
          example.kind === 'hard_negatives' &&
          example.feedback.some((feedback) => feedback.reason?.includes('Consumer.ts')),
      ),
    ).toBe(true);
    const oldAttempt = (await service.store.attemptForMessage('c', 'a1'))!;
    expect((await service.store.currentFeedback(oldAttempt.attempt_id))?.label).toBe('not_useful');
    service.stop();

    // Simulate stopping after the feedback event was synced but before its job
    // could be enqueued; the completed job must not suppress the newer revision.
    await service.store.recordFeedback({
      attemptId: oldAttempt.attempt_id,
      rating: 1,
      label: 'partially_useful',
    });
    const restarted = new LearningService({ root, repositories, generator: { generate } });
    await restarted.initialize();
    await restarted.waitForCurrent();
    expect(generate).toHaveBeenCalledTimes(4);
    expect((await restarted.store.knowledgeArtifacts())[0].body).toContain(
      'Producer.ts is the origin.',
    );
    expect((await restarted.datasets.list('candidates')).length).toBeGreaterThan(candidates.length);
    restarted.stop();
  });

  it('does not retain active knowledge when a later correction is ungraded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeberg-worker-'));
    roots.push(root);
    const repositories = await fixtureRepository(root, { 'Consumer.ts': 'consume()' });
    const service = new LearningService({
      root,
      repositories,
      generator: {
        generate: async ({ prompt }) =>
          JSON.stringify({
            action: 'upsert',
            category: 'flows',
            slug: 'origin',
            title: 'Origin',
            confidence: 'high',
            status: 'active',
            claims: [
              {
                statement: 'Consumer.ts is the origin.',
                evidence: [
                  {
                    repo: basename(
                      (
                        JSON.parse(prompt) as {
                          interaction: { attempts: { repositories: { path: string }[] }[] };
                        }
                      ).interaction.attempts[0].repositories[0].path,
                    ),
                    path: 'Consumer.ts',
                    quote: 'consume()',
                  },
                ],
              },
            ],
          }),
      },
    });

    await service.initialize();
    await service.recordSession('c', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is the origin?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'Consumer.ts' },
            output: { path: 'Consumer.ts', body: 'consume()' },
          },
          { type: 'text', text: 'Consumer.ts is the origin.' },
        ],
      },
    ] as UIMessage[]);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    await service.recordSession('c', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is the origin?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available',
            input: { path: 'Consumer.ts' },
            output: { path: 'Consumer.ts', body: 'consume()' },
          },
          { type: 'text', text: 'Consumer.ts is the origin.' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'No, that is only a consumer.' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I will check the producer.' }],
      },
    ] as UIMessage[]);
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    const interaction = await service.store.interaction(
      (await service.store.attempts())[0].interaction_id,
    );
    const currentRevision = sourceRevision(interaction.attempts, interaction.feedback);
    expect(
      (await service.datasets.list('candidates')).some(
        (row) => row.kind === 'sft' && row.source_revision === currentRevision,
      ),
    ).toBe(false);
    service.stop();
  });
});
