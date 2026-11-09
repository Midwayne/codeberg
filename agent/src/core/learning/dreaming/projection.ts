import type { KnowledgeArtifact } from '../types.js';
import { changesApplicable } from './revision.js';
import type { DreamingReport } from './types.js';

/** Resolve dependent views without writing canonical knowledge; every input must remain fresh. */
export function projectDreamingKnowledge(
  artifacts: KnowledgeArtifact[],
  reports: DreamingReport[],
  freshIds: Set<string>,
): KnowledgeArtifact[] {
  const available = new Set(freshIds);
  const current = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const applied = reports
    .filter((report) => report.status === 'applied')
    .sort(
      (a, b) =>
        a.decisions[0].timestamp.localeCompare(b.decisions[0].timestamp) ||
        a.id.localeCompare(b.id),
    );

  const remaining = new Set(applied);
  for (;;) {
    let progressed = false;
    for (const report of remaining) {
      if (!changesApplicable(report.changes, current, available)) continue;

      for (const { after } of report.changes) {
        current.set(after.id, after);
        if (after.status === 'archived') available.delete(after.id);
      }

      remaining.delete(report);
      progressed = true;
    }

    if (!progressed) break;
  }

  return [...current.values()];
}
