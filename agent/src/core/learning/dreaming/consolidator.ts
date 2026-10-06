import type { Generator } from '../../types.js';
import type { LearningStore } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';
import { planChanges } from './changes.js';
import { dreamingInput, planDreaming } from './planner.js';
import type { DreamingReports } from './reports.js';
import { artifactFingerprint } from './revision.js';
import type { DreamingReport } from './types.js';

/** Model selects groups; deterministic code preserves facts, provenance and provisional notes. */
export class DreamingConsolidator {
  constructor(
    private readonly store: LearningStore,
    private readonly reports: DreamingReports,
    private readonly generator: Generator,
    private readonly categories: () => Partial<
      Record<KnowledgeArtifact['category'], boolean>
    > = () => ({}),
  ) {}

  async plan(id: string): Promise<DreamingReport> {
    const existing = await this.reports.get(id);
    if (existing) return existing;

    const artifacts = (await this.store.currentKnowledgeArtifacts()).filter(
      (artifact) => this.categories()[artifact.category] !== false,
    );
    const reviewed = new Map<string, { fingerprint: string; timestamp: string }>();
    for (const report of (await this.reports.list()).reverse())
      for (const input of report.inputs ?? []) {
        reviewed.set(input.id, { fingerprint: input.fingerprint, timestamp: report.created_at });
      }

    const { included, omitted } = dreamingInput(artifacts, reviewed);
    // currentKnowledgeArtifacts strips provisional notes from recall. Preserve them in revisions.
    const projected = new Map(
      (await this.store.projectedKnowledgeArtifacts()).map((artifact) => [artifact.id, artifact]),
    );
    const originals = new Map(
      included.map((artifact) => [artifact.id, projected.get(artifact.id)!]),
    );
    const plan =
      included.length > 1
        ? await planDreaming(this.generator, included, id)
        : { summary: 'No knowledge groups to consolidate.', merges: [], links: [] };

    const now = new Date().toISOString();
    const changes = await planChanges(plan, originals, await this.store.repositories(), now);

    return this.reports.save({
      schema_version: 1,
      id,
      created_at: now,
      summary: plan.summary,
      considered: included.length,
      omitted,
      inputs: included.map((artifact) => ({
        id: artifact.id,
        fingerprint: artifactFingerprint(artifact),
      })),
      changes,
      status: 'proposed',
      decisions: [],
    });
  }
}
