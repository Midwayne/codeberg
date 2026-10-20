import type { DatasetExample } from '../datasets.js';
import { redactSecrets } from '../redact.js';
import type {
  OutputReport,
  OutputResult,
  OutputRun,
  OutputScorer,
  ScorerInput,
  ScoreSummary,
} from './types.js';
import { validateInputs, validateScore } from './validation.js';

/** Pass DatasetStore.active('eval') so superseded reviews cannot enter a comparison. */
export async function evaluateOutputs(
  examples: DatasetExample[],
  runs: OutputRun[],
  scorers: OutputScorer[],
): Promise<OutputReport> {
  validateInputs(examples, runs, scorers);
  const byId = new Map(runs.map((run) => [run.eval_id, run]));
  const results: OutputResult[] = [];
  const missing: string[] = [];
  for (const example of examples) {
    const run = byId.get(example.id);
    if (!run) {
      missing.push(example.id);
      continue;
    }

    results.push(await evaluateExample(example, run, scorers));
  }

  return {
    version: 1,
    total: examples.length,
    evaluated: results.length,
    missing,
    results,
    summary: summarize(results, scorers),
  };
}

async function evaluateExample(
  example: DatasetExample,
  run: OutputRun,
  scorers: OutputScorer[],
): Promise<OutputResult> {
  const oracle = example.review!.oracle!;
  const input: ScorerInput = {
    input: example.query,
    output: run.output,
    expected: oracle.expected,
    context: run.context,
    output_format: oracle.output_format,
  };
  const scores: OutputResult['scores'] = [];
  for (const scorer of scorers) {
    try {
      scores.push(validateScore(await scorer.score(structuredClone(input)), scorer.name));
    } catch (error) {
      scores.push({
        name: scorer.name,
        score: null,
        error: redactSecrets(String(error instanceof Error ? error.message : error)),
      });
    }
  }

  return {
    eval_id: example.id,
    source_interaction_id: example.source_interaction_id,
    source_revision: example.source_revision,
    repository_commits: example.repositories.map(({ name, commit }) => ({ name, commit })),
    ...(run.model !== undefined ? { model: run.model } : {}),
    scores,
  };
}

function summarize(results: OutputResult[], scorers: OutputScorer[]): Record<string, ScoreSummary> {
  return Object.fromEntries(
    scorers.map(({ name }) => {
      const rows = results.flatMap((result) =>
        result.scores.filter((score) => score.name === name),
      );
      const values = rows.flatMap((row) =>
        row.error === undefined && row.score !== null ? [row.score] : [],
      );

      return [
        name,
        {
          mean: values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null,
          scored: values.length,
          skipped: rows.filter((row) => row.error === undefined && row.score === null).length,
          errors: rows.filter((row) => row.error !== undefined).length,
        },
      ];
    }),
  );
}
