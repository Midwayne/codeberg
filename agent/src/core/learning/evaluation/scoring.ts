import { JobFailure } from '../errors.js';
import type { EvaluationCheckpoint } from './automatic-types.js';
import type { InvalidTask } from './task-check.js';
import type { EvalScore, OutputScorer, ScorerInput } from './types.js';

export interface ScoringHooks {
  /** Rechecked before each score, so a superseded task stops spending judge calls. */
  invalid(): Promise<InvalidTask | undefined>;
  save(): Promise<void>;
}

/** Reuse checkpointed scores after a retry and checkpoint each new one. */
export function cachedScorers(
  scorers: OutputScorer[],
  checkpoint: EvaluationCheckpoint,
  hooks: ScoringHooks,
): OutputScorer[] {
  return scorers.map((scorer) => ({
    name: scorer.name,
    score: (input) => cachedScore(scorer, input, checkpoint, hooks),
  }));
}

async function cachedScore(
  scorer: OutputScorer,
  input: ScorerInput,
  checkpoint: EvaluationCheckpoint,
  hooks: ScoringHooks,
): Promise<EvalScore> {
  const invalid = await hooks.invalid();
  if (invalid) throw new JobFailure('PERMANENT_ERROR', invalid.reason);

  const cached = checkpoint.scores.find((score) => score.name === scorer.name);
  if (cached) return cached;

  const score = await scorer.score(input);
  checkpoint.scores.push(score);
  await hooks.save();

  return score;
}
