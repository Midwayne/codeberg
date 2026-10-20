import type { DatasetStore } from '../datasets.js';
import type { DurableJobQueue } from '../queue.js';
import { stableId, type LearningStore } from '../store.js';
import type {
  AutomaticEvalReport,
  EvaluationConfiguration,
  EvaluationRuntime,
  EvaluationTask,
} from './automatic-types.js';
import { processEvaluation } from './process.js';
import { EvaluationReports } from './reports.js';

export class AutomaticEvaluations {
  readonly reports: EvaluationReports;

  private checking?: Promise<void>;

  private rescan = false;

  constructor(
    readonly store: LearningStore,
    readonly datasets: DatasetStore,
    readonly queue: DurableJobQueue,
    readonly runtime: EvaluationRuntime,
    readonly enabled: () => boolean,
  ) {
    this.reports = new EvaluationReports(store.root);
  }

  reconcile(): Promise<void> {
    this.rescan = true;
    this.checking ??= this.scanUntilCurrent().finally(() => {
      this.checking = undefined;
    });

    return this.checking;
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

    const repositories = (await this.store.repositories()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
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

  process(id: string, attempt: number): Promise<void> {
    return processEvaluation(this, id, attempt);
  }
}

export function sameConfiguration(
  a: EvaluationConfiguration,
  b?: EvaluationConfiguration,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
