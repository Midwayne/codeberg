import type { LearningStore } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';
import { mergeArtifacts } from './merge.js';
import type { DreamingChange, DreamingPlan } from './types.js';

export async function planChanges(
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

export function applyLinks(
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
