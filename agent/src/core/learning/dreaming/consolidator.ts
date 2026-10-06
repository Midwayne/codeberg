import { basename } from 'node:path';
import type { Generator } from '../../types.js';
import { withUserNotes } from '../artifact-body.js';
import { knowledgeBody, validatedClaims } from '../claims.js';
import { observeSources, sourceCommits, sourceHashes } from '../memory-source.js';
import type { LearningStore } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';
import { dreamingInput, planDreaming } from './planner.js';
import type { DreamingReports } from './reports.js';
import { artifactFingerprint } from './revision.js';
import type { DreamingChange, DreamingPlan, DreamingReport } from './types.js';

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

async function planChanges(
  plan: DreamingPlan,
  originals: Map<string, KnowledgeArtifact>,
  repositories: Awaited<ReturnType<LearningStore['repositories']>>,
  now: string,
): Promise<DreamingChange[]> {
  const changes = new Map<string, DreamingChange>();
  const destinations = new Map<string, string>();
  for (const merge of plan.merges) {
    const group = [merge.target_id, ...merge.source_ids].map((key) => originals.get(key)!);
    const target = group[0];
    const after = await mergeArtifacts(group, repositories, now);

    changes.set(target.id, { before: target, after, reason: merge.reason });
    for (const artifact of group.slice(1)) {
      destinations.set(artifact.id, target.id);
      changes.set(artifact.id, {
        before: artifact,
        after: { ...artifact, status: 'archived', merged_into: target.id, updated_at: now },
        reason: merge.reason,
      });
    }
  }

  applyLinks(plan.links, changes, destinations, originals, now);

  // Link-only targets must also be revision-checked before the report is applied.
  for (const change of [...changes.values()])
    for (const to of change.after.related_ids ?? []) {
      if (!changes.has(to) && originals.has(to))
        changes.set(to, {
          before: originals.get(to)!,
          after: originals.get(to)!,
          reason: 'Linked reference.',
        });
    }

  return [...changes.values()];
}

function applyLinks(
  links: DreamingPlan['links'],
  changes: Map<string, DreamingChange>,
  destinations: Map<string, string>,
  originals: Map<string, KnowledgeArtifact>,
  now: string,
): void {
  for (const link of links) {
    const from = destinations.get(link.from_id) ?? link.from_id;
    const to = destinations.get(link.to_id) ?? link.to_id;
    if (from === to) continue;

    const before = originals.get(from)!;
    const prior = changes.get(from);
    const after = prior?.after ?? before;
    if (after.related_ids?.includes(to)) continue;

    changes.set(from, {
      before,
      after: { ...after, related_ids: [...(after.related_ids ?? []), to], updated_at: now },
      reason: [prior?.reason, link.reason].filter(Boolean).join(' '),
    });
  }
}

async function mergeArtifacts(
  group: KnowledgeArtifact[],
  repositories: Awaited<ReturnType<LearningStore['repositories']>>,
  now: string,
): Promise<KnowledgeArtifact> {
  const target = group[0];

  const rawClaims = unique(group.flatMap((artifact) => artifact.claims ?? []));
  if (
    !rawClaims.length ||
    rawClaims.length > 12 ||
    group.some((artifact) => !artifact.claims?.length)
  ) {
    throw new Error('INVALID_RESPONSE: merge would omit claims; use links instead');
  }

  const refs = unique(group.flatMap((artifact) => artifact.source_refs ?? []));
  const observations = await observeSources(refs, repositories);
  const claims = validatedClaims(rawClaims, observations);
  if (claims?.length !== rawClaims.length)
    throw new Error('INVALID_RESPONSE: merge evidence changed or cannot be verified');

  const notes = unique(group.flatMap((artifact) => artifact.user_confirmed_notes ?? []));
  const revisions = mergedRevisions(group);

  return {
    ...target,
    claims,
    body: withUserNotes(knowledgeBody(claims), notes),
    user_confirmed_notes: notes.length ? notes : undefined,
    repositories: [...new Set(observations.map((observation) => basename(observation.repo)))],
    source_interactions: [...new Set(group.flatMap((artifact) => artifact.source_interactions))],
    source_revisions: revisions,
    historical_source_interactions: [
      ...new Set(group.flatMap((artifact) => artifact.historical_source_interactions ?? [])),
    ],
    source_refs: refs,
    source_hashes: sourceHashes(observations),
    source_commits: sourceCommits(repositories),
    related_ids: [...new Set(group.flatMap((artifact) => artifact.related_ids ?? []))].filter(
      (key) => !group.some((artifact) => artifact.id === key),
    ),
    updated_at: now,
    last_verified_at: now,
    confidence: lowestConfidence(group),
  };
}

function mergedRevisions(group: KnowledgeArtifact[]): Record<string, string> {
  const revisions: Record<string, string> = {};

  for (const artifact of group) {
    for (const key of artifact.source_interactions) {
      revisions[key] = (artifact.source_revisions?.[key] ?? artifact.source_revision)!;
    }
  }

  return revisions;
}

function unique<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function lowestConfidence(group: KnowledgeArtifact[]): KnowledgeArtifact['confidence'] {
  return group.some((artifact) => artifact.confidence === 'low')
    ? 'low'
    : group.some((artifact) => artifact.confidence === 'medium')
      ? 'medium'
      : 'high';
}
