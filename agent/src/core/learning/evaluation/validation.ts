import type { DatasetExample } from '../datasets.js';
import { validateReview } from '../datasets/records.js';
import type { EvalScore, OutputRun, OutputScorer } from './types.js';

export function validateInputs(
  examples: DatasetExample[],
  runs: OutputRun[],
  scorers: OutputScorer[],
): void {
  const ids = new Set<string>();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`duplicate eval ID: ${example.id}`);

    if (example.state !== 'eval' || example.confidence !== 'verified' || !example.review)
      throw new Error('Output scoring requires reviewed held-out examples');

    validateReview(example, 'eval', example.review);
    ids.add(example.id);
  }

  const seen = new Set<string>();
  for (const run of runs) {
    if (
      !run ||
      typeof run.eval_id !== 'string' ||
      !Object.hasOwn(run, 'output') ||
      run.output === undefined
    )
      throw new Error('Each run requires eval_id and output');

    if (!ids.has(run.eval_id)) throw new Error(`unknown eval ID: ${run.eval_id}`);

    if (seen.has(run.eval_id)) throw new Error(`duplicate run ID: ${run.eval_id}`);

    if (
      run.context !== undefined &&
      (!Array.isArray(run.context) || !run.context.every((text) => typeof text === 'string'))
    )
      throw new Error('Run context must be an array of strings');

    if (run.model !== undefined && typeof run.model !== 'string')
      throw new Error('Run model must be a string');

    seen.add(run.eval_id);
  }

  const names = scorers.map((scorer) => scorer.name);
  if (names.some((name) => !name.trim()) || new Set(names).size !== names.length)
    throw new Error('Scorer names must be nonempty and cannot be duplicate');
}

export function validateScore(result: EvalScore, name: string): EvalScore {
  if (
    !result ||
    result.name !== name ||
    (result.score !== null &&
      (typeof result.score !== 'number' ||
        !Number.isFinite(result.score) ||
        result.score < 0 ||
        result.score > 1))
  ) {
    throw new Error('Scorer must return its own name and a finite score in [0,1] or null');
  }

  return { name, score: result.score, ...(result.metadata ? { metadata: result.metadata } : {}) };
}
