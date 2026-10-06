import { basename } from 'node:path';
import { withUserNotes } from '../artifact-body.js';
import { knowledgeBody, validatedClaims } from '../claims.js';
import { observeSources, sourceCommits, sourceHashes } from '../memory-source.js';
import type { LearningStore } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';

export async function mergeArtifacts(
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

export function mergedRevisions(group: KnowledgeArtifact[]): Record<string, string> {
  const revisions: Record<string, string> = {};

  for (const artifact of group) {
    for (const key of artifact.source_interactions) {
      revisions[key] = (artifact.source_revisions?.[key] ?? artifact.source_revision)!;
    }
  }

  return revisions;
}

export function unique<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

export function lowestConfidence(group: KnowledgeArtifact[]): KnowledgeArtifact['confidence'] {
  return group.some((artifact) => artifact.confidence === 'low')
    ? 'low'
    : group.some((artifact) => artifact.confidence === 'medium')
      ? 'medium'
      : 'high';
}
