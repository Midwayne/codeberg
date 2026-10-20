import { basename } from 'node:path';
import type { DatasetExample } from '../datasets.js';
import { scoreRetrievalRuns } from '../metrics.js';
import type { RetrievalRun } from '../metrics/types.js';
import { classifyFailure, isTransientFailure, MAX_ATTEMPTS } from '../queue/policy.js';
import { redactSecrets } from '../redact.js';
import { LearningPaused } from '../worker/constants.js';
import { sameConfiguration, type AutomaticEvaluations } from './automatic.js';
import type {
  AutomaticEvalReport,
  EvaluationCheckpoint,
  EvaluationTask,
} from './automatic-types.js';
import { judgeScorers } from './judge.js';
import { evaluateOutputs } from './runner.js';
import { outputScorers } from './scorers.js';
import type { OutputReport, OutputRun, OutputScorer } from './types.js';
import { validateInputs } from './validation.js';

export async function processEvaluation(
  state: AutomaticEvaluations,
  id: string,
  attempt: number,
): Promise<void> {
  const task = await state.reports.read<EvaluationTask>('tasks', id);
  if (!task) throw new Error('PERMANENT_ERROR: evaluation task not found');

  const prior = await state.reports.read<AutomaticEvalReport>('reports', id);
  if (prior && ['completed', 'skipped'].includes(prior.status)) return;

  const example = (await state.datasets.active('eval')).find(
    (row) => row.id === task.example_id && row.source_revision === task.source_revision,
  );
  const reason = await invalidTask(state, task, example);
  if (reason) {
    await state.reports.save({
      ...task,
      updated_at: new Date().toISOString(),
      status: reason.includes('reviewed oracle commits') ? 'skipped' : 'superseded',
      reason,
    });
    return;
  }

  try {
    await gradeEvaluation(state, task, example!, attempt);
  } catch (error) {
    if (error instanceof LearningPaused) throw error;

    const report = await state.reports.read<AutomaticEvalReport>('reports', id);
    await state.reports.save({
      ...task,
      ...report,
      updated_at: new Date().toISOString(),
      status: terminalFailure(String(error), attempt) ? 'failed' : 'retrying',
      reason: String(error),
    });
    throw error;
  }
}

async function invalidTask(
  state: AutomaticEvaluations,
  task: EvaluationTask,
  example?: DatasetExample,
): Promise<string | undefined> {
  if (!state.enabled()) throw new LearningPaused();

  if (!example) return 'Reviewed example was superseded';

  const configuration = await state.runtime.configuration();
  if (!sameConfiguration(task.configuration, configuration)) return 'Model selection changed';

  const current = (await state.store.repositories()).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(current) !== JSON.stringify(task.repositories))
    return 'Repository version changed during evaluation';

  if (
    example.repositories.some(
      (repo) =>
        repo.commit &&
        !current.some(
          (source) => basename(source.path) === repo.name && source.commit === repo.commit,
        ),
    )
  )
    return 'Current repositories do not match the reviewed oracle commits';

  return undefined;
}

async function gradeEvaluation(
  state: AutomaticEvaluations,
  task: EvaluationTask,
  example: DatasetExample,
  attempt: number,
): Promise<void> {
  validateInputs([example], [], outputScorers());
  const checkpoint = (await state.reports.read<EvaluationCheckpoint>('runs', task.id)) ?? {
    scores: [],
  };
  if (!checkpoint.candidate) {
    checkpoint.candidate = redactSecrets(
      await state.runtime.candidate(example.query, task.configuration),
    );
    await state.reports.checkpoint(task.id, checkpoint);
  }

  const scorers = [
    ...outputScorers(),
    ...judgeScorers(state.runtime.judge(task.configuration), task.configuration.judge.model),
  ];
  const run = {
    ...checkpoint.candidate,
    eval_id: example.id,
    model: task.configuration.candidate.model,
  };
  const report = await evaluateOutputs(
    [example],
    [run],
    cachedScorers(state, task, checkpoint, scorers),
  );

  await publishEvaluation(state, task, example, run, report, attempt);
}

async function publishEvaluation(
  state: AutomaticEvaluations,
  task: EvaluationTask,
  example: DatasetExample,
  run: OutputRun & RetrievalRun,
  report: OutputReport,
  attempt: number,
): Promise<void> {
  const errors = report.results.flatMap((row) =>
    row.scores.flatMap((score) => (score.error === undefined ? [] : [score.error])),
  );
  const reason = await invalidTask(
    state,
    task,
    (await state.datasets.active('eval')).find((row) => row.id === example.id),
  );
  const status = reason
    ? 'superseded'
    : errors.length
      ? terminalFailure(errors.join('; '), attempt)
        ? 'failed'
        : 'retrying'
      : 'completed';
  await state.reports.save({
    ...task,
    updated_at: new Date().toISOString(),
    status,
    reason: reason ?? errors.join('; '),
    report,
    retrieval: scoreRetrievalRuns([example], [run]),
  });
  if (!reason && errors.length) throw new Error(errors.join('; '));
}

function terminalFailure(error: string, attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS || !isTransientFailure(classifyFailure(error));
}

function cachedScorers(
  state: AutomaticEvaluations,
  task: EvaluationTask,
  checkpoint: EvaluationCheckpoint,
  scorers: OutputScorer[],
): OutputScorer[] {
  return scorers.map((scorer) => ({
    name: scorer.name,
    score: async (input) => {
      if (!state.enabled()) throw new LearningPaused();

      const reason = await invalidTask(
        state,
        task,
        (await state.datasets.active('eval')).find((row) => row.id === task.example_id),
      );
      if (reason) throw new Error(`PERMANENT_ERROR: ${reason}`);

      const cached = checkpoint.scores.find((score) => score.name === scorer.name);
      if (cached) return cached;

      const score = await scorer.score(input);
      checkpoint.scores.push(score);
      await state.reports.checkpoint(task.id, checkpoint);

      return score;
    },
  }));
}
