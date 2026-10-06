import type { UIMessage } from 'ai';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DatasetStore, EXTRACTION_VERSION } from './datasets.js';
import { exportDataset } from './export.js';
import { writeJsonImmutable } from './fs.js';
import { DurableJobQueue } from './queue.js';
import { LearningService } from './service.js';
import { LearningStore } from './store.js';
import { KnowledgeWorker } from './worker.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-datasets-'));
  roots.push(root);
  const store = new LearningStore(root);

  return { root, store, datasets: new DatasetStore(store) };
}

function tool(
  name: string,
  input: unknown,
  output: unknown,
  id: string,
): UIMessage['parts'][number] {
  return {
    type: 'dynamic-tool',
    toolName: name,
    toolCallId: id,
    state: 'output-available',
    input,
    output,
  } as UIMessage['parts'][number];
}
const question = 'Where does inventory availability ultimately come from?';

function first(): UIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: question }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        tool(
          'semantic_search',
          {
            query: 'inventory availability',
            authorization: 'Bearer private123',
            env: 'SERVICE_API_KEY=abc123value',
          },
          [
            { path: 'AvailabilityClient.kt', score: 0.91, snippet: 'token=supersecret' },
            { path: 'InventoryCalculator.kt', symbol: 'calculateAvailability', score: 0.78 },
          ],
          'search-1',
        ),
        tool(
          'open_file',
          { path: 'AvailabilityClient.kt' },
          { path: 'AvailabilityClient.kt', body: 'endpoint /availability' },
          'open-1',
        ),
        { type: 'text', text: 'AvailabilityClient.kt produces it.' },
      ],
    },
  ];
}

function corrected(): UIMessage[] {
  return [
    ...first(),
    {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'No, the client is just a consumer. Trace the producer.' }],
    },
    {
      id: 'a2',
      role: 'assistant',
      parts: [
        tool(
          'semantic_search',
          { query: 'producer calculateAvailability' },
          [{ path: 'InventoryCalculator.kt', symbol: 'calculateAvailability', score: 0.78 }],
          'search-2',
        ),
        tool(
          'open_file',
          { path: 'InventoryCalculator.kt' },
          { path: 'InventoryCalculator.kt', body: 'fun calculateAvailability()' },
          'open-2',
        ),
        tool('run_tests', { command: 'test inventory' }, { passed: true, tests: 3 }, 'test-2'),
        { type: 'text', text: 'The origin is InventoryCalculator.kt in calculateAvailability.' },
      ],
    },
  ];
}

describe('versioned dataset capture', () => {
  it('persists ordered sanitized observations and revised feedback, with distinct immutable revisions', async () => {
    const { root, store, datasets } = await fixture();
    await store.recordSession('c', first());
    const initial = (await store.attempts())[0];
    expect(initial.trajectory?.map((step) => step.kind)).toEqual([
      'user',
      'tool_call',
      'observation',
      'tool_call',
      'observation',
      'answer',
    ]);
    expect(initial.retrieved_results[0]).toMatchObject({
      rank: 1,
      score: 0.91,
      search_query: 'inventory availability',
    });
    await store.recordFeedback({ attemptId: initial.attempt_id, label: 'solved', rating: 3 });
    const before = await datasets.extract(initial.interaction_id);
    await store.recordFeedback({
      attemptId: initial.attempt_id,
      label: 'not_useful',
      rating: 0,
      reason: 'AvailabilityClient.kt is not the producer',
    });
    await store.recordSession('c', corrected());
    const attempts = await store.attempts();
    expect(attempts[1].interaction_id).toBe(initial.interaction_id);
    await store.recordFeedback({ attemptId: attempts[1].attempt_id, label: 'solved', rating: 3 });
    const after = await datasets.extract(initial.interaction_id);
    expect(after.map((e) => e.kind)).toEqual([
      'retrieval',
      'hard_negatives',
      'sft',
      'preferences',
      'rlvr',
    ]);
    expect(after[0].payload).toMatchObject({
      proposed_evidence: expect.arrayContaining([
        {
          path: 'InventoryCalculator.kt',
          rank: 1,
          tool: 'semantic_search',
          tool_call_id: 'search-2',
          score: 0.78,
          search_query: 'producer calculateAvailability',
          symbol: 'calculateAvailability',
        },
      ]),
      oracle: { files: [], provenance: 'unverified' },
      signals: { tool_calls: 5, files_opened: 2, oracle_file_hit: undefined },
    });
    expect(after[1].payload).toMatchObject({
      hard_negatives: [expect.objectContaining({ path: 'AvailabilityClient.kt' })],
      reason_negative: 'rated_rejection_naming_file',
    });
    expect(after[3].payload).toMatchObject({
      rejected: 'AvailabilityClient.kt produces it.',
      chosen: 'The origin is InventoryCalculator.kt in calculateAvailability.',
    });
    expect(after[4].payload).toMatchObject({
      verifier: { tool: 'run_tests', status: 'requires_review' },
    });
    expect(after[0]).toMatchObject({
      extraction_version: EXTRACTION_VERSION,
      source_interaction_id: initial.interaction_id,
      state: 'candidate',
    });
    expect((await datasets.list('candidates')).length).toBe(before.length + after.length);
    expect(
      await readFile(join(root, 'datasets', 'candidates', `${before[0].id}.json`), 'utf8'),
    ).toContain('"source_revision"');
    const raw =
      JSON.stringify(await store.events()) + JSON.stringify(await datasets.list('candidates'));
    expect(raw).not.toContain('private123');
    expect(raw).not.toContain('supersecret');
    expect(raw).not.toContain('abc123value');
  });

  it('requires verified review and blocks exact and semantic near-duplicates across splits and legacy exports', async () => {
    const { root, store, datasets } = await fixture();
    await store.recordSession('c', corrected());
    const attempts = await store.attempts();
    await store.recordFeedback({ attemptId: attempts[1].attempt_id, rating: 3, label: 'solved' });
    const candidates = await datasets.extract(attempts[0].interaction_id);
    const retrieval = candidates.find((row) => row.kind === 'retrieval')!;
    const sft = candidates.find((row) => row.kind === 'sft')!;
    expect(sft.kind).toBe('sft');
    await writeJsonImmutable(join(root, 'datasets', 'candidates', 'legacy.json'), {
      ...retrieval,
      id: 'legacy',
      extraction_version: EXTRACTION_VERSION - 1,
    });
    await expect(
      datasets.promote('legacy', 'training', { provenance: 'user_confirmed' }),
    ).rejects.toThrow('obsolete schema');
    await expect(
      datasets.promote(retrieval.id, 'eval', {
        provenance: 'answer_referenced',
        oracle: { files: ['InventoryCalculator.kt'] },
      }),
    ).rejects.toThrow('independent provenance');
    await expect(
      datasets.promote(retrieval.id, 'eval', {
        provenance: 'user_confirmed',
        oracle: { notes: 'seems plausible' },
      }),
    ).rejects.toThrow('reviewed repository');
    await datasets.promote(retrieval.id, 'eval', {
      provenance: 'user_confirmed',
      oracle: { files: ['InventoryCalculator.kt'] },
    });
    expect(await exportDataset(store, 'eval')).toMatchObject([
      { state: 'eval', review: { oracle: { files: ['InventoryCalculator.kt'] } } },
    ]);
    await expect(
      datasets.promote(sft.id, 'training', { provenance: 'user_confirmed' }),
    ).rejects.toThrow('opposite split');
    expect(await exportDataset(store, 'openai-chat')).toEqual([]);
    await store.recordSession('other', [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'Where does inventory availability ultimately originate from?' },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool(
            'semantic_search',
            { query: 'availability' },
            [{ path: 'InventoryCalculator.kt' }],
            't',
          ),
          { type: 'text', text: 'InventoryCalculator.kt' },
        ],
      },
    ]);
    const other = (await store.attempts()).at(-1)!;
    await store.recordFeedback({ attemptId: other.attempt_id, rating: 3, label: 'solved' });
    const candidate = (await datasets.extract(other.interaction_id))[0];
    await expect(
      datasets.promote(candidate.id, 'training', { provenance: 'user_confirmed' }),
    ).rejects.toThrow('semantic duplicate');
    expect(await datasets.list('eval')).toHaveLength(1);
    expect(await datasets.list('training')).toHaveLength(0);
    await store.recordFeedback({
      attemptId: attempts[1].attempt_id,
      rating: 0,
      label: 'not_useful',
    });
    expect(await datasets.active('eval')).toEqual([]);
    expect(await exportDataset(store, 'eval')).toEqual([]);
    await expect(
      datasets.promote(sft.id, 'training', { provenance: 'user_confirmed' }),
    ).rejects.toThrow('stale');
  });

  it('keeps a corrected cited file unjudged without explicit file-level feedback', async () => {
    const { store, datasets } = await fixture();
    await store.recordSession('c', first());
    const firstAttempt = (await store.attempts())[0];
    await store.recordFeedback({
      attemptId: firstAttempt.attempt_id,
      rating: 0,
      label: 'not_useful',
    });
    await store.recordSession('c', corrected());
    const last = (await store.attempts()).at(-1)!;
    await store.recordFeedback({ attemptId: last.attempt_id, rating: 3, label: 'solved' });
    const examples = await datasets.extract(last.interaction_id);
    expect(examples.find((row) => row.kind === 'hard_negatives')).toBeUndefined();
    const proposed = examples.find((row) => row.kind === 'hard_negative_candidates');
    expect(proposed?.payload).toMatchObject({
      proposed_negatives: [expect.objectContaining({ path: 'AvailabilityClient.kt' })],
    });
    await expect(
      datasets.promote(proposed!.id, 'training', { provenance: 'agent_inferred' }),
    ).rejects.toThrow('reviewed negative paths');
  });

  it('does not infer a negative from a neutral follow-up despite an earlier low rating', async () => {
    const { store, datasets } = await fixture();
    await store.recordSession('c', first());
    const initial = (await store.attempts())[0];
    await store.recordFeedback({ attemptId: initial.attempt_id, rating: 0, label: 'not_useful' });
    const messages = corrected();
    messages[2] = {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'Actually, what about the producer service?' }],
    };
    await store.recordSession('c', messages);
    const last = (await store.attempts()).at(-1)!;
    await store.recordFeedback({ attemptId: last.attempt_id, rating: 3, label: 'solved' });
    const rows = await datasets.extract(last.interaction_id);
    expect(
      rows.some((row) => row.kind === 'hard_negatives' || row.kind === 'hard_negative_candidates'),
    ).toBe(false);
  });

  it('does not treat a previously solved answer as the winner after an ungraded correction', async () => {
    const { store, datasets } = await fixture();
    await store.recordSession('c', first());
    const previous = (await store.attempts())[0];
    await store.recordFeedback({ attemptId: previous.attempt_id, rating: 3, label: 'solved' });
    await store.recordSession('c', corrected());
    const rows = await datasets.extract(previous.interaction_id);
    expect(rows.map((row) => row.kind)).toEqual(['retrieval']);
    expect(rows[0].payload).toMatchObject({ proposed_evidence: [] });
  });

  it('keeps retrieval RLVR verification provisional until an oracle is reviewed', async () => {
    const { store, datasets } = await fixture();
    await store.recordSession('c', first());
    const attempt = (await store.attempts())[0];
    await store.recordFeedback({ attemptId: attempt.attempt_id, label: 'solved', rating: 3 });
    const candidate = (await datasets.extract(attempt.interaction_id)).find(
      (row) => row.kind === 'rlvr',
    );
    expect(candidate?.payload).toMatchObject({
      verifier: {
        kind: 'repository_evidence',
        proposed_files: ['AvailabilityClient.kt'],
        status: 'requires_review',
      },
    });
    expect(candidate?.confidence).toBe('unverified');
  });

  it('recovers interrupted dataset jobs using the existing lease and idempotent extractor', async () => {
    const { root, store, datasets } = await fixture();
    await store.recordSession('c', first());
    const id = (await store.attempts())[0].interaction_id;
    let now = Date.now();
    const queue = new DurableJobQueue(root, () => new Date(now), 10);
    await queue.enqueueDataset(id);
    expect((await queue.claim())?.type).toBe('extract_dataset');
    now += 20;
    expect(await queue.recoverExpired()).toBe(1);
    const worker = new KnowledgeWorker(store, queue);
    await worker.runUntilIdle();
    expect((await queue.counts()).completed).toBe(1);
    expect(await datasets.list('candidates')).toHaveLength(1);
    await queue.enqueueDataset(id, { requeueCompleted: true });
    await worker.runUntilIdle();
    expect(await datasets.list('candidates')).toHaveLength(1);
    expect((await datasets.list('candidates'))[0].extracted_at).toBeDefined();
    worker.stop();
  });

  it('enqueues dataset capture independently of KB and requeues after changing a solved grade', async () => {
    const { root } = await fixture();
    const service = new LearningService({ root });
    await service.initialize();
    await service.recordSession('c', first());
    const attempt = (await service.store.attempts())[0];
    await service.waitForCurrent();
    expect(await service.datasets.list('candidates')).toHaveLength(1);
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
    await service.waitForCurrent();
    expect((await service.queue.list('pending')).map((job) => job.type)).toContain(
      'extract_knowledge',
    );
    expect((await service.queue.list('failed')).map((job) => job.type)).not.toContain(
      'extract_knowledge',
    );
    expect(await service.activeJobs()).toBe(0);
    await service.feedback({
      conversationId: 'c',
      messageId: 'a1',
      rating: 0,
      label: 'not_useful',
      reason: 'wrong',
    });
    await service.waitForCurrent();
    expect(
      (await service.datasets.list('candidates')).some((row) =>
        row.feedback.some((f) => f.reason === 'wrong'),
      ),
    ).toBe(true);
    expect(await service.queue.get(`job-${'impossible'}`)).toBeUndefined();
    expect(attempt.trajectory).toBeDefined();
    service.stop();
  });

  it('reconciles a feedback event saved immediately before a process shutdown', async () => {
    const { root, store } = await fixture();
    await store.recordSession('c', first());
    const attempt = (await store.attempts())[0];
    await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    const restarted = new LearningService({ root });
    await restarted.initialize();
    await restarted.waitForCurrent();
    expect(
      (await restarted.datasets.list('candidates')).some(
        (row) => row.feedback[0]?.label === 'solved',
      ),
    ).toBe(true);
    restarted.stop();
  });
});

it('captures only the enabled example kinds without deleting existing candidates', async () => {
  const { store, datasets } = await fixture();
  await store.recordSession('kind-filter', corrected());
  const attempts = await store.attempts();
  await store.recordFeedback({ attemptId: attempts[0].attempt_id, label: 'not_useful', rating: 0 });
  await store.recordFeedback({ attemptId: attempts[1].attempt_id, label: 'solved', rating: 3 });
  const kinds = {
    retrieval: false,
    hard_negatives: false,
    sft: true,
    preferences: false,
    rlvr: false,
    hard_negative_candidates: false,
  };

  expect(
    (await datasets.extract(attempts[0].interaction_id, kinds)).map((row) => row.kind),
  ).toEqual(['sft']);
  expect((await datasets.list('candidates')).map((row) => row.kind)).toEqual(['sft']);
  expect((await datasets.extract(attempts[0].interaction_id)).length).toBeGreaterThan(1);
  await datasets.extract(attempts[0].interaction_id, kinds);
  expect((await datasets.list('candidates')).length).toBeGreaterThan(1);
});
