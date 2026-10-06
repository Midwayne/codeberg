import { validatedClaims } from '../claims.js';
import { knowledgePrompt } from '../knowledge-prompt.js';
import { evidenceRefs, observeSources, relocatedSources, sourceKey } from '../memory-source.js';
import { LearningStore } from '../store.js';
import type { AttemptRecord, KnowledgeArtifact, KnowledgeJob } from '../types.js';

export type PreparationContext = Omit<
  ExtractionContext,
  'existing' | 'observations' | 'refresh'
> & {
  artifacts: KnowledgeArtifact[];
  sourceChanged: boolean;
};

export function extractionRefs(existing: KnowledgeArtifact[], attempts: AttemptRecord[]) {
  // A later correction may cite no files itself; reread evidence from the whole interaction.
  return [
    ...new Map(
      [
        ...existing.flatMap((artifact) => artifact.source_refs ?? []),
        ...attempts.flatMap(evidenceRefs),
      ].map((ref) => [sourceKey(ref), ref]),
    ).values(),
  ];
}

export type ExtractionContext = Parameters<typeof knowledgePrompt>[0] & {
  job: KnowledgeJob;
  revision: string;
  currentRepositories: Awaited<ReturnType<LearningStore['repositories']>>;
};

export async function refreshObservations(
  observations: Parameters<typeof validatedClaims>[1],
  repositories: Awaited<ReturnType<LearningStore['repositories']>>,
  refresh: boolean,
) {
  // Old tool observations cannot establish facts about a changed codebase.
  if (refresh && observations.some((item) => !item.hash)) {
    const missing = observations.filter((item) => !item.hash);
    const alternatives = (
      await Promise.all(missing.map((ref) => relocatedSources(ref, repositories)))
    ).flat();
    const replacements = await observeSources(alternatives, repositories);
    observations = [
      ...observations.filter((item) => item.hash),
      ...replacements.filter((item) => item.hash),
    ];
  }

  return observations;
}
