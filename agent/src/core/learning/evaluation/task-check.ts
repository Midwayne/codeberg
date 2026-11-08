import { basename } from 'node:path';
import type { DatasetExample } from '../datasets/records.js';
import { LearningPaused } from '../errors.js';
import type { LearningStore } from '../store.js';
import type { RepositoryVersion } from '../types.js';
import type { EvaluationRuntime, EvaluationTask } from './automatic-types.js';

export type InvalidTask = { status: 'skipped' | 'superseded'; reason: string };

/** Tasks pin models and repository versions; any drift makes a pending grade meaningless. */
export class EvaluationTaskCheck {
  constructor(
    private readonly store: LearningStore,
    private readonly runtime: EvaluationRuntime,
    private readonly enabled: () => boolean,
  ) {}

  /** Repository versions in the stable order a task records them. */
  async repositories(): Promise<RepositoryVersion[]> {
    return (await this.store.repositories()).sort((a, b) => a.path.localeCompare(b.path));
  }

  async invalid(task: EvaluationTask, example?: DatasetExample): Promise<InvalidTask | undefined> {
    if (!this.enabled()) throw new LearningPaused();

    if (!example) return superseded('Reviewed example was superseded');

    const configuration = await this.runtime.configuration();
    if (!sameJson(task.configuration, configuration)) return superseded('Model selection changed');

    const current = await this.repositories();
    if (!sameJson(current, task.repositories))
      return superseded('Repository version changed during evaluation');

    if (example.repositories.some((repo) => repo.commit && !checkedOut(current, repo)))
      return {
        status: 'skipped',
        reason: 'Current repositories do not match the reviewed oracle commits',
      };

    return undefined;
  }
}

function checkedOut(
  current: RepositoryVersion[],
  repo: DatasetExample['repositories'][number],
): boolean {
  return current.some(
    (source) => basename(source.path) === repo.name && source.commit === repo.commit,
  );
}

function superseded(reason: string): InvalidTask {
  return { status: 'superseded', reason };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
