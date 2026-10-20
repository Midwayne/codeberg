import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { DatasetStore } from '../core/learning/datasets.js';
import { LearningStore } from '../core/learning/store.js';
import { scoreOutputsFile } from './output-evals.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-output-evals-'));
  roots.push(root);
  const store = new LearningStore(root, async () => []);
  const [attempt] = await store.recordSession('conversation', [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'What does the count return?' }] },
    { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: '3' }] },
  ]);
  await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
  const datasets = new DatasetStore(store);
  const example = (await datasets.extract(attempt.interaction_id)).find(
    (row) => row.kind === 'sft',
  )!;
  await datasets.promote(example.id, 'eval', {
    provenance: 'tests',
    oracle: { expected: '3', output_format: 'json' },
  });
  const path = join(root, 'runs.jsonl');
  await writeFile(path, JSON.stringify({ eval_id: example.id, output: '3' }) + '\n');

  return { store, path, attempt };
}

it('scores a reviewed local dataset through the CLI without selecting a provider', async () => {
  const { store, path } = await fixture();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  await scoreOutputsFile(store, [path]);

  const report = JSON.parse(log.mock.calls[0][0]);
  expect(report).toMatchObject({
    total: 1,
    evaluated: 1,
    summary: { exact_match: { mean: 1 }, valid_json: { mean: 1 } },
  });
  expect(Object.keys(report.summary)).toEqual(['exact_match', 'valid_json']);
});

it('rejects a submitted result after its review has become stale', async () => {
  const { store, path, attempt } = await fixture();
  await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 0, label: 'not_useful' });

  await expect(scoreOutputsFile(store, [path])).rejects.toThrow('unknown eval ID');
});

it.each([
  [],
  ['file', '--judge'],
  ['file', '--judge', 'missing-provider'],
  ['file', '--unexpected'],
])('rejects invalid CLI arguments %j', async (...args) => {
  await expect(scoreOutputsFile(new LearningStore('/unused'), args)).rejects.toThrow('Usage:');
});
