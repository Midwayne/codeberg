import type { DatasetStore } from '../datasets.js';
import type { DurableJobQueue } from '../queue.js';
import { stableId } from '../store/identity.js';
import type { LearningStore } from '../store.js';
import type { AutomaticEvalReport, EvaluationRuntime, EvaluationTask } from './automatic-types.js';
import { EvaluationProcessor } from './process.js';
import { EvaluationReports } from './reports.js';
import { EvaluationTaskCheck } from './task-check.js';

/** Schedules one durable task per current held-out example, model pair and repository version. */
export class AutomaticEvaluations {
  readonly reports: EvaluationReports;

  private readonly check: EvaluationTaskCheck;

  private readonly processor: EvaluationProcessor;

  private checking?: Promise<void>;

  private rescan = false;

  constructor(
    store: LearningStore,
    private readonly datasets: DatasetStore,
    private readonly queue: DurableJobQueue,
    private readonly runtime: EvaluationRuntime,
    readonly enabled: () => boolean,
  ) {
    this.reports = new EvaluationReports(store.root);
    this.check = new EvaluationTaskCheck(store, runtime, enabled);
    this.processor = new EvaluationProcessor(this.reports, datasets, runtime, this.check);
  }

  reconcile(): Promise<void> {
    this.rescan = true;
    this.checking ??= this.scanUntilCurrent().finally(() => {
      this.checking = undefined;
    });

    return this.checking;
  }

  process(id: string, attempt: number): Promise<void> {
    return this.processor.process(id, attempt);
  }

  private async scanUntilCurrent(): Promise<void> {
    while (this.rescan) {
      this.rescan = false;
      await this.schedule();
    }
  }

  private async schedule(): Promise<void> {
    if (!this.enabled()) return;

    const configuration = await this.runtime.configuration();
    if (!configuration) return;

    const repositories = await this.check.repositories();
    for (const example of await this.datasets.active('eval')) {
      if (!this.enabled()) return;

      const id = stableId(
        'evaluation',
        'read-only-rag-v1',
        JSON.stringify(example),
        JSON.stringify(configuration),
        JSON.stringify(repositories),
      );
      const task: EvaluationTask = {
        id,
        harness_version: 1,
        example_id: example.id,
        source_revision: example.source_revision,
        configuration: structuredClone(configuration),
        repositories,
      };
      await this.reports.task(task);
      const previous = await this.reports.read<AutomaticEvalReport>('reports', id);
      await this.queue.enqueueEvaluation(id, {
        requeueCompleted: previous?.status === 'superseded',
      });
    }
  }
}
