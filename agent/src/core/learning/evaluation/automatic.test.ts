import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { LearningService } from '../service.js';
import { DatasetStore } from '../datasets.js';
import type { EvaluationConfiguration, EvaluationRuntime } from './automatic-types.js';
import type { RepositoryVersion } from '../types.js';
import { writeJsonAtomic } from '../fs.js';

const roots: string[] = [];
const services: LearningService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-automatic-evals-'));
  roots.push(root);
  const configuration: EvaluationConfiguration = {
    candidate: { key: 'candidate', model: 'test:candidate', effort: 'none', contextWindow: 32000 },
    judge: { key: 'judge', model: 'test:judge', effort: 'none', contextWindow: 32000 },
  };
  const candidate = vi.fn(async (_question: string, _configuration: EvaluationConfiguration) => ({
    output: '3',
    context: ['The count is 3.'],
    hits: [],
    latency_ms: 10,
  }));
  const generate = vi.fn(async () =>
    JSON.stringify({ choice: 'all', rationale: 'The count matches the source.' }),
  );
  const runtime: EvaluationRuntime = {
    configuration: async () => configuration,
    candidate,
    judge: () => ({ generate }),
  };
  const repositories: RepositoryVersion[] = [];
  const service = new LearningService({
    root,
    evaluation: runtime,
    repositories: async () => repositories,
  });
  services.push(service);
  await service.updateSettings({ knowledge: false });
  await service.initialize();
  const [attempt] = await service.store.recordSession('conversation', [
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'What does count return?' }] },
    {
      id: 'a',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Old answer must not reach candidate' }],
    },
  ]);
  await service.store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
  const example = (await service.datasets.extract(attempt.interaction_id)).find(
    (row) => row.kind === 'sft',
  )!;

  return { service, runtime, configuration, candidate, generate, example, attempt, repositories };
}

async function approve(service: LearningService, id: string) {
  await service.datasets.promote(id, 'eval', {
    provenance: 'tests',
    oracle: { expected: '3', output_format: 'json' },
  });
  await service.waitForCurrent();
}

it('automatically executes and persists a fresh candidate and separate scores after approval', async () => {
  const { service, candidate, generate, example } = await fixture();
  await approve(service, example.id);

  expect(candidate).toHaveBeenCalledTimes(1);
  expect(candidate.mock.calls[0][0]).toEqual(example.query);
  expect(JSON.stringify(candidate.mock.calls[0])).not.toContain('Old answer');
  expect(generate).toHaveBeenCalledTimes(2);
  expect(await service.evaluationReports.list()).toMatchObject([
    { status: 'completed', report: { evaluated: 1, summary: { factuality: { mean: 1 } } } },
  ]);
  expect(await service.queue.list('completed')).toContainEqual(
    expect.objectContaining({ type: 'evaluate_output' }),
  );
});

it('does not rerun unchanged evaluations after scans or restart, and reruns after model changes', async () => {
  const { service, candidate, example, runtime, configuration } = await fixture();
  await approve(service, example.id);
  await service.refreshEvaluations();
  await service.waitForCurrent();
  service.stop();
  const restarted = new LearningService({
    root: service.store.root,
    evaluation: runtime,
    repositories: async () => [],
  });
  services.push(restarted);
  await restarted.initialize();
  await restarted.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(1);
  configuration.candidate.model = 'test:new-candidate';
  await restarted.refreshEvaluations();
  await restarted.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(2);
  expect(await restarted.evaluationReports.list()).toHaveLength(2);
});

it('defers while evaluations are paused and resumes automatically when enabled', async () => {
  const { service, candidate, example } = await fixture();
  await service.updateSettings({ evals: false });
  await approve(service, example.id);

  expect(candidate).not.toHaveBeenCalled();
  await service.updateSettings({ evals: true });
  await service.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(1);
});

it('checkpoints candidate output and successful judges across a retryable judge failure', async () => {
  const { service, example, candidate, generate } = await fixture();
  generate.mockRejectedValueOnce(new Error('network timeout'));
  await approve(service, example.id);
  const [pending] = (await service.queue.list('pending')).filter(
    (job) => job.type === 'evaluate_output',
  );

  expect(pending).toMatchObject({ attempt_count: 1, last_error_category: 'NETWORK_ERROR' });
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'retrying' }]);
  // Make this persisted retry due without waiting for the production backoff.
  await writeJsonAtomic(join(service.store.root, 'jobs', 'pending', `${pending.job_id}.json`), {
    ...pending,
    next_attempt_at: new Date(0).toISOString(),
  });
  service.worker?.wake();
  await service.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'completed' }]);
});

it('supersedes a queued evaluation if its reviewed source revision changes', async () => {
  const { service, example, candidate, attempt } = await fixture();
  service.worker?.pause();
  await service.datasets.promote(example.id, 'eval', {
    provenance: 'tests',
    oracle: { expected: '3' },
  });
  await service.store.recordFeedback({
    attemptId: attempt.attempt_id,
    rating: 0,
    label: 'not_useful',
  });
  service.worker?.resume();
  await service.waitForCurrent();

  expect(candidate).not.toHaveBeenCalled();
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'superseded' }]);
});

it('recovers an approved but unprocessed task on startup without another approval', async () => {
  const { service, example, candidate, runtime } = await fixture();
  service.worker?.pause();
  await approve(service, example.id);
  service.stop();
  const restarted = new LearningService({
    root: service.store.root,
    evaluation: runtime,
    repositories: async () => [],
  });
  services.push(restarted);
  await restarted.initialize();
  await restarted.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(1);
  expect(await restarted.evaluationReports.list()).toMatchObject([{ status: 'completed' }]);
});

it('keeps terminal provider failures terminal across later scans', async () => {
  const { service, example, candidate } = await fixture();
  candidate.mockRejectedValue(new Error('PERMANENT_ERROR: prompt exceeds context budget'));
  await approve(service, example.id);
  await service.refreshEvaluations();
  await service.waitForCurrent();

  expect(candidate).toHaveBeenCalledTimes(1);
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'failed' }]);
  expect(await service.queue.list('failed')).toContainEqual(
    expect.objectContaining({ type: 'evaluate_output', attempt_count: 1 }),
  );
});

it('retries failures at most five times, then retains the failed report', async () => {
  const { service, example, candidate } = await fixture();
  candidate.mockRejectedValue(new Error('network timeout'));
  await approve(service, example.id);

  for (let index = 1; index < 5; index++) {
    const job = (await service.queue.list('pending')).find(
      (row) => row.type === 'evaluate_output',
    )!;
    await writeJsonAtomic(join(service.store.root, 'jobs', 'pending', `${job.job_id}.json`), {
      ...job,
      next_attempt_at: new Date(0).toISOString(),
    });
    service.worker?.wake();
    await service.waitForCurrent();
  }

  await service.refreshEvaluations();
  await service.waitForCurrent();
  expect(candidate).toHaveBeenCalledTimes(5);
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'failed' }]);
});

it('reconsiders a superseded task when its model selection returns', async () => {
  const { service, example, candidate, configuration } = await fixture();
  service.worker?.pause();
  await approve(service, example.id);
  configuration.candidate.model = 'test:temporary-selection';
  service.worker?.resume();
  await service.waitForCurrent();
  expect(candidate).not.toHaveBeenCalled();

  configuration.candidate.model = 'test:candidate';
  await service.refreshEvaluations();
  await service.waitForCurrent();
  expect(candidate).toHaveBeenCalledTimes(1);
  expect(await service.evaluationReports.list()).toMatchObject([{ status: 'completed' }]);
});

it('skips an oracle whose pinned commit does not match the live repository', async () => {
  const { service, example, candidate, repositories } = await fixture();
  // The source snapshot is immutable; simulate a reviewed row that pins an older commit.
  const reviewed = { ...example, repositories: [{ name: 'repo', commit: 'old' }] };
  await writeJsonAtomic(
    join(service.store.root, 'datasets', 'candidates', `${example.id}.json`),
    reviewed,
  );
  repositories.push({ path: '/project/repo', commit: 'new' });
  await approve(service, example.id);

  expect(candidate).not.toHaveBeenCalled();
  expect(await service.evaluationReports.list()).toMatchObject([
    { status: 'skipped', reason: expect.stringContaining('reviewed oracle commits') },
  ]);
});

it('automatically discovers reviews written outside the service on its periodic scan', async () => {
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const { service, example, candidate } = await fixture();
  await new DatasetStore(service.store).promote(example.id, 'eval', {
    provenance: 'tests',
    oracle: { expected: '3' },
  });
  expect(candidate).not.toHaveBeenCalled();
  const scan = intervals.mock.calls.find(([, delay]) => delay === 2 * 60_000)![0] as () => void;
  scan();

  await vi.waitFor(async () => {
    expect(await service.evaluationReports.list()).toMatchObject([{ status: 'completed' }]);
  });
  expect(candidate).toHaveBeenCalledTimes(1);
});

it('waits for model configuration without making calls and picks up configuration on a later scan', async () => {
  const { service, example, candidate, runtime, configuration } = await fixture();
  const selected = vi.spyOn(runtime, 'configuration').mockResolvedValue(undefined);
  await approve(service, example.id);
  expect(candidate).not.toHaveBeenCalled();

  selected.mockResolvedValue(configuration);
  await service.refreshEvaluations();
  await service.waitForCurrent();
  expect(candidate).toHaveBeenCalledTimes(1);
});
