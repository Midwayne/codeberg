import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalText, writeJsonAtomic, writeJsonImmutable } from '../fs.js';
import { redactSecrets } from '../redact.js';
import { isStableId } from '../store/identity.js';
import type {
  AutomaticEvalReport,
  EvaluationCheckpoint,
  EvaluationTask,
} from './automatic-types.js';

export function isEvaluationId(id: string): boolean {
  return isStableId('evaluation', id);
}

/** Tasks are immutable; checkpoints and the latest report survive interrupted jobs. */
export class EvaluationReports {
  constructor(private readonly root: string) {}

  private path(bucket: string, id: string): string {
    if (!isEvaluationId(id)) throw new Error('invalid evaluation id');

    return join(this.root, 'evaluations', bucket, `${id}.json`);
  }

  async read<T>(bucket: string, id: string): Promise<T | undefined> {
    const raw = await readOptionalText(this.path(bucket, id));
    if (raw === undefined) return undefined;

    return JSON.parse(raw) as T;
  }

  async task(task: EvaluationTask): Promise<void> {
    await writeJsonImmutable(this.path('tasks', task.id), task);
  }

  async checkpoint(id: string, checkpoint: EvaluationCheckpoint): Promise<void> {
    await writeJsonAtomic(this.path('runs', id), checkpoint);
  }

  async save(report: AutomaticEvalReport): Promise<void> {
    await writeJsonAtomic(this.path('reports', report.id), redactSecrets(report));
  }

  async list(): Promise<AutomaticEvalReport[]> {
    const files = await readdir(join(this.root, 'evaluations', 'reports')).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];

        throw error;
      },
    );
    const reports = await Promise.all(
      files
        .filter((file) => file.endsWith('.json') && isEvaluationId(file.slice(0, -5)))
        .map((file) => this.read<AutomaticEvalReport>('reports', file.slice(0, -5))),
    );

    return reports
      .filter((report): report is AutomaticEvalReport => Boolean(report))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
  }
}
