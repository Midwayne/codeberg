import { describe, expect, it } from 'vitest';

import type { DatasetExample } from '../datasets.js';
import { outputScorers } from './scorers.js';
import { judgeScorers } from './judge.js';
import { evaluateOutputs } from './runner.js';

const example = {
  id: 'eval-1',
  kind: 'sft',
  state: 'eval',
  source_interaction_id: 'interaction-1',
  extraction_version: 2,
  source_revision: 'revision-1',
  extracted_at: '2026-01-01',
  query: 'What is returned?',
  repositories: [{ name: 'server', commit: 'abc' }],
  feedback: [],
  provenance: 'tests',
  confidence: 'verified',
  payload: { answer: 'Do not use an unreviewed answer as the reference' },
  review: {
    timestamp: '2026-01-01',
    provenance: 'tests',
    oracle: { expected: { count: 3 }, output_format: 'json' },
  },
} satisfies DatasetExample;

describe('output evaluations', () => {
  it('scores independent dimensions and keeps skips and missing runs out of means', async () => {
    const report = await evaluateOutputs(
      [example, { ...example, id: 'eval-2' }],
      [{ eval_id: example.id, output: { count: 3 }, model: 'candidate-v1' }],
      outputScorers(),
    );

    expect(report).toMatchObject({
      total: 2,
      evaluated: 1,
      missing: ['eval-2'],
      summary: {
        exact_match: { mean: 1, scored: 1, skipped: 0, errors: 0 },
        valid_json: { mean: 1, scored: 1, skipped: 0, errors: 0 },
      },
      results: [
        {
          source_revision: 'revision-1',
          repository_commits: [{ name: 'server', commit: 'abc' }],
          model: 'candidate-v1',
        },
      ],
    });

    const noOracle = { ...example, review: { ...example.review, oracle: { files: ['a.ts'] } } };
    const skipped = await evaluateOutputs(
      [noOracle],
      [{ eval_id: example.id, output: 'answer' }],
      outputScorers(),
    );

    expect(skipped.summary.exact_match).toEqual({ mean: null, scored: 0, skipped: 1, errors: 0 });
    expect(skipped.results[0].scores.every((score) => score.score === null)).toBe(true);
  });

  it('checks exact values without confusing JSON validity with correctness', async () => {
    const report = await evaluateOutputs(
      [example],
      [{ eval_id: example.id, output: '{"count":4}' }],
      outputScorers(),
    );

    expect(report.summary.exact_match.mean).toBe(0);
    expect(report.summary.valid_json.mean).toBe(1);

    const invalid = await evaluateOutputs(
      [example],
      [{ eval_id: example.id, output: '{' }],
      outputScorers(),
    );

    expect(invalid.summary.valid_json.mean).toBe(0);
  });

  it('rejects duplicate or unknown IDs, missing outputs and unreviewed examples', async () => {
    const run = { eval_id: example.id, output: null };

    await expect(evaluateOutputs([example], [run, run], [])).rejects.toThrow('duplicate');
    await expect(evaluateOutputs([example], [{ ...run, eval_id: 'unknown' }], [])).rejects.toThrow(
      'unknown',
    );
    await expect(
      evaluateOutputs([example], [{ eval_id: example.id } as never], []),
    ).rejects.toThrow('output');
    await expect(evaluateOutputs([{ ...example, state: 'training' }], [run], [])).rejects.toThrow(
      'reviewed',
    );
    await expect(evaluateOutputs([example, example], [run], [])).rejects.toThrow('duplicate');
  });

  it('records scorer errors separately and continues other scorers and cases', async () => {
    const report = await evaluateOutputs(
      [example],
      [{ eval_id: example.id, output: { count: 3 } }],
      [
        {
          name: 'broken',
          score: () => {
            throw new Error('provider failed');
          },
        },
        { name: 'invalid', score: () => ({ name: 'invalid', score: NaN }) },
        ...outputScorers(),
      ],
    );

    expect(report.summary.broken).toEqual({ mean: null, scored: 0, skipped: 0, errors: 1 });
    expect(report.summary.invalid.errors).toBe(1);
    expect(report.summary.exact_match.mean).toBe(1);
    expect(report.results[0].scores[0]).toMatchObject({ score: null, error: 'provider failed' });
  });

  it('supports async custom scorers and rejects mismatched names and out-of-range values', async () => {
    const run = { eval_id: example.id, output: 'answer' };
    const report = await evaluateOutputs(
      [example],
      [run],
      [
        {
          name: 'custom',
          score: async ({ input }) => ({ name: 'custom', score: input ? 0.5 : 0 }),
        },
        { name: 'range', score: () => ({ name: 'range', score: 2 }) },
        { name: 'mismatch', score: () => ({ name: 'different', score: 1 }) },
      ],
    );

    expect(report.summary.custom.mean).toBe(0.5);
    expect(report.summary.range.errors).toBe(1);
    expect(report.summary.mismatch.errors).toBe(1);
    await expect(
      evaluateOutputs([example], [run], [outputScorers()[0], outputScorers()[0]]),
    ).rejects.toThrow('duplicate');
  });
});

describe('model judges', () => {
  it('uses explicit rubrics, reviewed expected data, and records judge provenance', async () => {
    const prompts: { system: string; prompt: string }[] = [];
    const generator = {
      generate: async (prompt: { system: string; prompt: string }) => {
        prompts.push(prompt);

        return JSON.stringify({ choice: 'partial', rationale: 'One required detail is missing.' });
      },
    };
    const report = await evaluateOutputs(
      [example],
      [{ eval_id: example.id, output: '3', context: ['count is 3'] }],
      judgeScorers(generator, 'provider:judge-v1'),
    );

    expect(report.summary.factuality.mean).toBe(0.5);
    expect(report.summary.faithfulness.mean).toBe(0.5);
    expect(report.results[0].scores[0].metadata).toMatchObject({
      model: 'provider:judge-v1',
      rubric_version: 1,
      choice: 'partial',
    });
    expect(prompts[0].system).toContain('untrusted data');
    expect(JSON.parse(prompts[0].prompt).expected).toEqual({ count: 3 });
    expect(prompts[0].prompt).not.toContain(example.payload.answer);
  });

  it('skips inapplicable judges without model calls and exposes malformed responses as errors', async () => {
    let calls = 0;
    const scorers = judgeScorers(
      {
        generate: async () => {
          calls++;
          return '{"choice":"pass"}';
        },
      },
      'judge',
    );
    const noOracle = { ...example, review: { ...example.review, oracle: { files: ['a.ts'] } } };
    const skipped = await evaluateOutputs(
      [noOracle],
      [{ eval_id: example.id, output: 'a' }],
      scorers,
    );

    expect(calls).toBe(0);
    expect(skipped.summary.factuality.skipped).toBe(1);
    expect(skipped.summary.faithfulness.skipped).toBe(1);

    const failed = await evaluateOutputs(
      [example],
      [{ eval_id: example.id, output: 'a' }],
      scorers,
    );

    expect(calls).toBe(1);
    expect(failed.summary.factuality.errors).toBe(1);
    expect(failed.summary.factuality.mean).toBeNull();
  });
});
