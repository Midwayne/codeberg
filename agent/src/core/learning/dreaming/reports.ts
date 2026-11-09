import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { changesApplicable } from './revision.js';

import { readOptionalDirectory, readOptionalText, writeJsonImmutable } from '../fs.js';
import type { LearningStore } from '../store.js';
import type { DreamingDecision, DreamingReport } from './types.js';
import { LearningError } from '../errors.js';

export function isDreamingReportId(id: string): boolean {
  return /^dream-[a-z0-9-]{1,70}$/.test(id);
}

/** Immutable proposals and decision revisions; publication uses an atomic create, not a lock lease. */
export class DreamingReports {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, 'dreaming');
  }

  private checkId(id: string): void {
    if (!isDreamingReportId(id)) throw new LearningError('invalid', 'invalid dreaming report id');
  }

  async save(report: DreamingReport): Promise<DreamingReport> {
    this.checkId(report.id);
    await writeJsonImmutable(join(this.dir, `${report.id}.json`), report);

    return (await this.get(report.id))!;
  }

  async get(id: string): Promise<DreamingReport | undefined> {
    this.checkId(id);
    const raw = await readOptionalText(join(this.dir, `${id}.json`));
    if (raw === undefined) return undefined;

    let report = JSON.parse(raw) as DreamingReport;

    const revisions = await readOptionalDirectory(join(this.dir, id));

    const latest = revisions
      .filter((file) => /^\d{8}\.json$/.test(file))
      .sort()
      .at(-1);

    if (latest) {
      const receipt = JSON.parse(await readFile(join(this.dir, id, latest), 'utf8')) as Pick<
        DreamingReport,
        'status' | 'decisions'
      >;

      report = { ...report, ...receipt };
    }

    return report;
  }

  async list(): Promise<DreamingReport[]> {
    const files = await readOptionalDirectory(this.dir);

    const reports = await Promise.all(
      files
        .filter((file) => /^dream-[a-z0-9-]+\.json$/.test(file))
        .map((file) => this.get(file.slice(0, -5))),
    );

    return reports
      .filter((report): report is DreamingReport => Boolean(report))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }

  async decide(
    id: string,
    action: DreamingDecision,
    store: LearningStore,
  ): Promise<DreamingReport> {
    const report = await this.get(id);
    if (!report) throw new LearningError('not_found', 'dreaming report not found');

    if (action === 'undo' ? report.status !== 'applied' : report.status !== 'proposed') {
      throw new LearningError('conflict', 'dreaming report already decided');
    }

    if (action === 'apply') await this.assertApplicable(report, store);

    const decisions = [...report.decisions, { action, timestamp: new Date().toISOString() }];
    const status = action === 'apply' ? 'applied' : action === 'undo' ? 'undone' : 'dismissed';
    const published = await writeJsonImmutable(
      join(this.dir, id, `${String(decisions.length).padStart(8, '0')}.json`),
      { status, decisions },
    );

    if (!published)
      throw new LearningError('conflict', 'dreaming decision already changed; refresh the report');

    return { ...report, status, decisions };
  }

  private async assertApplicable(report: DreamingReport, store: LearningStore): Promise<void> {
    if (!report.changes.length)
      throw new LearningError('conflict', 'dreaming report has no changes');

    const freshIds = new Set(
      (await store.currentKnowledgeArtifacts()).map((artifact) => artifact.id),
    );
    const current = new Map(
      (await store.projectedKnowledgeArtifacts()).map((artifact) => [artifact.id, artifact]),
    );

    if (!changesApplicable(report.changes, current, freshIds)) {
      throw new LearningError(
        'conflict',
        'stale dreaming report; generate a new report against current knowledge',
      );
    }
  }
}
