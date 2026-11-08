import type { DatasetStore } from '../datasets.js';
import type { DatasetExample } from '../datasets/records.js';
import { JobFailure, LearningPaused } from '../errors.js';
import { scoreRetrievalRuns } from '../metrics.js';
import type { RetrievalRun } from '../metrics/types.js';
import { classifyFailure, willRetry } from '../queue/policy.js';
import { redactSecrets } from '../redact.js';
import type { FailureCategory } from '../types.js';
import type {
  AutomaticEvalReport,
  EvaluationCheckpoint,
  EvaluationRuntime,
  EvaluationTask,
} from './automatic-types.js';
import { judgeScorers } from './judge.js';
import type { EvaluationReports } from './reports.js';
import { evaluateOutputs } from './runner.js';
import { cachedScorers } from './scoring.js';
import { outputScorers } from './scorers.js';
import type { EvaluationTaskCheck } from './task-check.js';
import type { OutputReport, OutputRun } from './types.js';
import { validateInputs } from './validation.js';

/** Grades one immutable task, checkpointing the candidate and each score across retries. */
export class EvaluationProcessor {
  constructor(
    private readonly reports: EvaluationReports,
    private readonly datasets: DatasetStore,
    private readonly runtime: EvaluationRuntime,
    private readonly check: EvaluationTaskCheck,
  ) {}

  async process(id: string, attempt: number): Promise<void> {
    const task = await this.reports.read<EvaluationTask>('tasks', id);
    if (!task) throw new JobFailure('PERMANENT_ERROR', 'evaluation task not found');

    const prior = await this.reports.read<AutomaticEvalReport>('reports', id);
    if (prior && ['completed', 'skipped'].includes(prior.status)) return;

    const example = await this.example(task, true);
    const invalid = await this.check.invalid(task, example);
    if (invalid) {
      await this.reports.save({ ...task, updated_at: new Date().toISOString(), ...invalid });
      return;
    }

    try {
      await this.grade(task, example!, attempt);
    } catch (error) {
      if (error instanceof LearningPaused) throw error;

      const report = await this.reports.read<AutomaticEvalReport>('reports', id);
      await this.reports.save({
        ...task,
        ...report,
        updated_at: new Date().toISOString(),
        status: failureStatus(error, attempt),
        reason: String(error),
      });
      throw error;
    }
  }

  private async example(task: EvaluationTask, sameRevision = false) {
    return (await this.datasets.active('eval')).find(
      (row) =>
        row.id === task.example_id &&
        (!sameRevision || row.source_revision === task.source_revision),
    );
  }

  private async grade(task: EvaluationTask, example: DatasetExample, attempt: number) {
    validateInputs([example], [], outputScorers());
    const checkpoint = (await this.reports.read<EvaluationCheckpoint>('runs', task.id)) ?? {
      scores: [],
    };
    if (!checkpoint.candidate) {
      checkpoint.candidate = redactSecrets(
        await this.runtime.candidate(example.query, task.configuration),
      );
      await this.reports.checkpoint(task.id, checkpoint);
    }

    const scorers = [
      ...outputScorers(),
      ...judgeScorers(this.runtime.judge(task.configuration), task.configuration.judge.model),
    ];
    const run = {
      ...checkpoint.candidate,
      eval_id: example.id,
      model: task.configuration.candidate.model,
    };
    const failures: unknown[] = [];
    const cached = cachedScorers(scorers, checkpoint, {
      invalid: async () => this.check.invalid(task, await this.example(task)),
      save: () => this.reports.checkpoint(task.id, checkpoint),
      failures,
    });
    const report = await evaluateOutputs([example], [run], cached);

    await this.publish(task, example, run, report, { attempt, failures });
  }

  private async publish(
    task: EvaluationTask,
    example: DatasetExample,
    run: OutputRun & RetrievalRun,
    report: OutputReport,
    outcome: { attempt: number; failures: unknown[] },
  ): Promise<void> {
    const errors = report.results.flatMap((row) =>
      row.scores.flatMap((score) => (score.error === undefined ? [] : [score.error])),
    );
    const invalid = await this.check.invalid(task, await this.example(task));
    const failure = errors.length
      ? new JobFailure(scoringCategory(outcome.failures), errors.join('; '))
      : undefined;

    await this.reports.save({
      ...task,
      updated_at: new Date().toISOString(),
      status: invalid?.status ?? (failure ? failureStatus(failure, outcome.attempt) : 'completed'),
      reason: invalid?.reason ?? errors.join('; '),
      report,
      retrieval: scoreRetrievalRuns([example], [run]),
    });
    if (!invalid && failure) throw failure;
  }
}

function failureStatus(error: unknown, attempt: number): 'retrying' | 'failed' {
  return willRetry(classifyFailure(error), attempt) ? 'retrying' : 'failed';
}

/** Any permanent scorer failure makes the whole grading attempt permanent. */
function scoringCategory(failures: unknown[]): FailureCategory {
  const categories = failures.map(classifyFailure);

  return (
    categories.find((category) => category === 'PERMANENT_ERROR') ?? categories[0] ?? 'MODEL_ERROR'
  );
}
